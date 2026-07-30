import { getCloudflareContext } from '@opennextjs/cloudflare';
import { APPROVAL_EVENT_TYPE, createCoreServices, type CoreServices } from '@website-factory/core';

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
    const pipeline = env.PROJECT_PIPELINE;
    services = createCoreServices({
      d1: env.DB,
      r2: env.ASSETS_BUCKET,
      env: env as unknown as Record<string, unknown>,
      // Development captures outbound email for /api/dev/emails (E2E + local
      // testing); other environments use the default structured-log sender.
      ...(env.APP_ENV === 'development' ? { emailSender: new DevInboxEmailSender() } : {}),
      // Submissions start the durable pipeline where the orchestrator binding
      // exists; without it (local `next dev`) the start is skipped and the
      // project waits at `created`.
      ...(pipeline
        ? {
            workflowStarter: {
              async start(params: { projectId: string; organizationId: string }) {
                const instance = await pipeline.create({ params });
                return { instanceId: instance.id };
              },
            },
            workflowSignaler: {
              async signalApproval(
                workflowInstanceId: string,
                payload: { approvalId: string; decision: 'approved' | 'rejected' },
              ) {
                const instance = await pipeline.get(workflowInstanceId);
                // Shared constant: must match the type the engine's gates
                // wait on, and must satisfy Cloudflare's event-type charset.
                await instance.sendEvent({ type: APPROVAL_EVENT_TYPE, payload });
              },
            },
          }
        : {}),
    });
    cache.set(env, services);
  }
  return services;
}
