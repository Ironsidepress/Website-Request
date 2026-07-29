import type {
  D1Database,
  R2Bucket,
  ScheduledController,
  ExecutionContext,
} from '@cloudflare/workers-types';
import { createMaintenance } from '@website-factory/core/maintenance';

/**
 * Orchestrator worker.
 *
 * Hosts scheduled maintenance now, and the `ProjectPipeline` Cloudflare
 * Workflow plus queue consumers from M5 (docs/workflow-state-machine.md).
 * D1/R2 bindings are optional until the environment is provisioned
 * (docs/environments.md); scheduled runs no-op with a log line when absent.
 */

export interface Env {
  APP_ENV: string;
  DB?: D1Database;
  ASSETS_BUCKET?: R2Bucket;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return Response.json({ service: 'website-factory-orchestrator', env: env.APP_ENV });
    }
    return new Response('Not found', { status: 404 });
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (!env.DB || !env.ASSETS_BUCKET) {
      console.log(
        JSON.stringify({
          event: 'maintenance.skipped',
          reason: 'D1/R2 bindings not provisioned in this environment',
        }),
      );
      return;
    }
    const maintenance = createMaintenance({ d1: env.DB, r2: env.ASSETS_BUCKET });
    ctx.waitUntil(
      maintenance.cleanupOrphanUploads().then((cleaned) => {
        console.log(JSON.stringify({ event: 'maintenance.orphan_uploads_cleaned', cleaned }));
      }),
    );
  },
};
