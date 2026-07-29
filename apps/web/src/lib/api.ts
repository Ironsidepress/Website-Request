import { ZodError } from 'zod';
import { DomainError, newId, unauthenticated, type Principal } from '@website-factory/core';

import { getServices } from './services';

/**
 * Thin route-handler plumbing (business logic stays in @website-factory/core):
 * - maps DomainError/ZodError to safe client-facing {code, message, correlationId}
 * - logs detailed internal errors keyed by the same correlation id
 * - enforces an Origin allowlist on state-changing requests (CSRF hardening on
 *   top of SameSite cookies)
 */

const STATUS_BY_CODE: Record<string, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  expired: 410,
  validation_failed: 400,
};

export function jsonError(code: string, message: string, status: number, correlationId?: string) {
  return Response.json({ code, message, ...(correlationId ? { correlationId } : {}) }, { status });
}

export async function handleApi(
  request: Request,
  handler: () => Promise<Response>,
): Promise<Response> {
  const correlationId = newId();
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const origin = request.headers.get('origin');
      if (origin) {
        const { env } = await getServices();
        if (!env.ALLOWED_ORIGINS.includes(origin)) {
          return jsonError('forbidden', 'Cross-origin request rejected', 403, correlationId);
        }
      }
    }
    return await handler();
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError('validation_failed', 'Request validation failed', 400, correlationId);
    }
    if (error instanceof DomainError) {
      return jsonError(error.code, error.message, STATUS_BY_CODE[error.code] ?? 400, correlationId);
    }
    console.error(
      JSON.stringify({
        event: 'api.error',
        correlationId,
        method: request.method,
        path: new URL(request.url).pathname,
        error:
          error instanceof Error ? { name: error.name, message: error.message } : String(error),
      }),
    );
    return jsonError('internal_error', 'Something went wrong', 500, correlationId);
  }
}

export async function requirePrincipal(request: Request): Promise<Principal> {
  const { auth } = await getServices();
  const principal = await auth.getPrincipal(request.headers);
  if (!principal) throw unauthenticated();
  return principal;
}
