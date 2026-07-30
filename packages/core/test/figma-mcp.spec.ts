import { describe, expect, it } from 'vitest';

import { FigmaMcpClient } from '../src/pipeline/figma-mcp';

interface RecordedCall {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** Canned Figma-MCP server: initialize (SSE), initialized, create_new_file. */
function fakeFigmaMcp(options?: { failCreate?: boolean }) {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({
      url: String(_url),
      headers: Object.fromEntries(Object.entries(init?.headers ?? {})) as Record<string, string>,
      body,
    });
    if (body.method === 'initialize') {
      return new Response(
        `event: message\ndata: ${JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: { protocolVersion: '2025-06-18', capabilities: {} },
        })}\n\n`,
        {
          status: 200,
          headers: { 'content-type': 'text/event-stream', 'mcp-session-id': 'sess-123' },
        },
      );
    }
    if (body.method === 'notifications/initialized') {
      return new Response(null, { status: 202 });
    }
    if (options?.failCreate) {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: { isError: true, content: [{ type: 'text', text: 'plan not accessible' }] },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                file_key: 'FKEY123',
                file_url: 'https://www.figma.com/design/FKEY123',
                message: 'created',
              }),
            },
          ],
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('FigmaMcpClient (ADR-0017 runtime client)', () => {
  it('initializes once, carries the session, and maps create_new_file to a design ref', async () => {
    const server = fakeFigmaMcp();
    const client = new FigmaMcpClient({
      token: 'figd_test_token',
      planKey: 'team::42',
      fetchImpl: server.fetchImpl,
    });

    const ref = await client.generateDesign({
      projectId: 'proj-1',
      organizationId: 'org-1',
      attempt: 1,
      inputArtifacts: [],
    });
    expect(ref).toEqual({
      fileKey: 'FKEY123',
      fileUrl: 'https://www.figma.com/design/FKEY123',
      nodeIds: [],
    });

    // figd_ tokens ride the X-Figma-Token header, never Authorization.
    expect(server.calls[0]?.headers['X-Figma-Token']).toBe('figd_test_token');
    expect(server.calls[0]?.headers.Authorization).toBeUndefined();
    // initialize → initialized → tools/call, with the session id attached.
    expect(server.calls.map((c) => c.body.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/call',
    ]);
    expect(server.calls[2]?.headers['mcp-session-id']).toBe('sess-123');
    const args = (server.calls[2]?.body.params as { arguments: Record<string, unknown> }).arguments;
    expect(args.planKey).toBe('team::42');
    expect(args.editorType).toBe('design');

    // A second call reuses the session instead of re-initializing.
    await client.generateDesign({
      projectId: 'proj-1',
      organizationId: 'org-1',
      attempt: 2,
      inputArtifacts: [],
    });
    expect(server.calls.filter((c) => c.body.method === 'initialize')).toHaveLength(1);
  });

  it('uses bearer auth for OAuth tokens and surfaces tool errors', async () => {
    const server = fakeFigmaMcp({ failCreate: true });
    const client = new FigmaMcpClient({
      token: 'oauth-token-abc',
      planKey: 'team::42',
      fetchImpl: server.fetchImpl,
    });
    await expect(
      client.generateDesign({
        projectId: 'proj-2',
        organizationId: 'org-1',
        attempt: 1,
        inputArtifacts: [],
      }),
    ).rejects.toThrow(/plan not accessible/);
    expect(server.calls[0]?.headers.Authorization).toBe('Bearer oauth-token-abc');
    expect(server.calls[0]?.headers['X-Figma-Token']).toBeUndefined();
  });
});
