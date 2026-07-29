import { getCloudflareContext } from '@opennextjs/cloudflare';
import { createCoreServices, type CoreServices } from '@website-factory/core';

/**
 * Composition entry point for route handlers. Services are memoized per
 * bindings object (one per isolate) — never at module scope with state that
 * could leak across environments.
 */
const cache = new WeakMap<object, CoreServices>();

export async function getServices(): Promise<CoreServices> {
  const { env } = await getCloudflareContext({ async: true });
  let services = cache.get(env);
  if (!services) {
    services = createCoreServices({ d1: env.DB, env: env as unknown as Record<string, unknown> });
    cache.set(env, services);
  }
  return services;
}
