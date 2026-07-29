/**
 * Orchestrator worker (M0 scaffolding).
 *
 * This worker will host the `ProjectPipeline` Cloudflare Workflow, queue
 * consumers and scheduled jobs (docs/workflow-state-machine.md). During M0 it
 * exposes only a health endpoint so the deploy pipeline and environment
 * skeletons can be verified without any feature code.
 */

export interface Env {
  APP_ENV: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return Response.json({ service: 'website-factory-orchestrator', env: env.APP_ENV });
    }
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
