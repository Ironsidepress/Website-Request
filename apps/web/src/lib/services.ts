import { getCloudflareContext } from '@opennextjs/cloudflare';
import { createCoreServices, type CoreServices } from '@website-factory/core';

import { DevInboxEmailSender } from './dev-inbox';

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
    services = createCoreServices({
      d1: env.DB,
      env: env as unknown as Record<string, unknown>,
      // Development captures outbound email for /api/dev/emails (E2E + local
      // testing); other environments use the default structured-log sender.
      ...(env.APP_ENV === 'development' ? { emailSender: new DevInboxEmailSender() } : {}),
    });
    cache.set(env, services);
  }
  return services;
}
