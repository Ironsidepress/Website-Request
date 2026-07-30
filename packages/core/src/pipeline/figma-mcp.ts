import type { FigmaClient, FigmaDesignRef, FigmaDesignRequest } from './figma';

/**
 * FigmaClient over Figma's hosted MCP server (ADR-0017).
 *
 * Speaks plain JSON-RPC over streamable HTTP — initialize once per client,
 * then tools/call — so it runs unchanged in Cloudflare Workers and Node.
 * Auth is a per-environment secret: `figd_` personal access tokens go in the
 * X-Figma-Token header; OAuth tokens use the Authorization bearer header.
 */

export interface FigmaMcpConfig {
  token: string;
  /** Team/organization plan that owns generated files, e.g. "team::123". */
  planKey: string;
  /** Defaults to Figma's hosted MCP endpoint. */
  endpoint?: string;
  /** Derived from the token prefix when omitted. */
  authScheme?: 'x-figma-token' | 'bearer';
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

interface JsonRpcResponse {
  result?: {
    content?: Array<{ type: string; text?: string }>;
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  };
  error?: { code: number; message: string };
}

const PROTOCOL_VERSION = '2025-06-18';

/** Streamable-HTTP servers may answer JSON or a one-shot SSE stream. */
function parseRpcBody(contentType: string, body: string): JsonRpcResponse {
  if (contentType.includes('text/event-stream')) {
    const dataLines = body
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);
    const last = dataLines[dataLines.length - 1];
    if (!last) throw new Error('figma mcp: empty event stream');
    return JSON.parse(last) as JsonRpcResponse;
  }
  return JSON.parse(body) as JsonRpcResponse;
}

export class FigmaMcpClient implements FigmaClient {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly authScheme: 'x-figma-token' | 'bearer';
  private sessionId: string | null = null;
  private nextId = 1;

  constructor(private readonly config: FigmaMcpConfig) {
    this.endpoint = config.endpoint ?? 'https://mcp.figma.com/mcp';
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.authScheme =
      config.authScheme ?? (config.token.startsWith('figd_') ? 'x-figma-token' : 'bearer');
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(this.authScheme === 'x-figma-token'
        ? { 'X-Figma-Token': this.config.token }
        : { Authorization: `Bearer ${this.config.token}` }),
      ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
    };
  }

  private async rpc(method: string, params: unknown): Promise<JsonRpcResponse> {
    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params }),
    });
    if (!response.ok) {
      throw new Error(`figma mcp: ${method} failed with HTTP ${response.status}`);
    }
    const session = response.headers.get('mcp-session-id');
    if (session) this.sessionId = session;
    const parsed = parseRpcBody(response.headers.get('content-type') ?? '', await response.text());
    if (parsed.error) {
      throw new Error(`figma mcp: ${method} error ${parsed.error.code}: ${parsed.error.message}`);
    }
    return parsed;
  }

  private async notify(method: string): Promise<void> {
    await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: '2.0', method }),
    });
  }

  private async ensureSession(): Promise<void> {
    if (this.sessionId) return;
    await this.rpc('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'website-factory-orchestrator', version: '1.0.0' },
    });
    await this.notify('notifications/initialized');
  }

  /** Extracts the tool result whether returned structured or as JSON text. */
  private static toolPayload(response: JsonRpcResponse): Record<string, unknown> {
    const result = response.result;
    if (!result) throw new Error('figma mcp: tool call returned no result');
    if (result.isError) {
      const text = result.content?.find((c) => c.text)?.text ?? 'unknown tool error';
      throw new Error(`figma mcp: tool error: ${text}`);
    }
    if (result.structuredContent) return result.structuredContent;
    const text = result.content?.find((c) => c.type === 'text' && c.text)?.text;
    if (!text) throw new Error('figma mcp: tool call returned no content');
    return JSON.parse(text) as Record<string, unknown>;
  }

  async generateDesign(request: FigmaDesignRequest): Promise<FigmaDesignRef> {
    await this.ensureSession();
    const response = await this.rpc('tools/call', {
      name: 'create_new_file',
      arguments: {
        fileName: `Website design — ${request.projectId} (attempt ${request.attempt})`,
        planKey: this.config.planKey,
        editorType: 'design',
      },
    });
    const payload = FigmaMcpClient.toolPayload(response);
    const fileKey = payload.file_key ?? payload.fileKey;
    const fileUrl = payload.file_url ?? payload.fileUrl;
    if (typeof fileKey !== 'string' || typeof fileUrl !== 'string') {
      throw new Error('figma mcp: create_new_file returned no file reference');
    }
    // First runtime slice creates the review file; brief-driven population
    // (use_figma authoring) layers on top without changing this contract.
    return { fileKey, fileUrl, nodeIds: [] };
  }
}
