import type { D1Database, R2Bucket, Workflow } from '@cloudflare/workers-types';

/**
 * Cloudflare bindings available to apps/web via getCloudflareContext().
 * Keep in sync with wrangler.jsonc. Secrets appear here as optional strings;
 * they are validated (presence + shape) by webEnvSchema at composition time.
 */
declare global {
  interface CloudflareEnv {
    DB: D1Database;
    ASSETS_BUCKET: R2Bucket;
    /** Cross-script binding to the orchestrator's ProjectPipeline workflow. */
    PROJECT_PIPELINE?: Workflow;
    APP_ENV: string;
    LOG_LEVEL?: string;
    ALLOWED_ORIGINS?: string;
    APP_BASE_URL?: string;
    BETTER_AUTH_SECRET?: string;
    INITIAL_ADMIN_EMAIL?: string;
  }
}

export {};
