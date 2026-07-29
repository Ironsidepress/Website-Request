/// <reference types="@cloudflare/vitest-pool-workers/types" />

import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { D1Migration } from '@cloudflare/vitest-pool-workers';

/** Bindings provided to tests via vitest.config.ts (miniflare options). */
declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      ASSETS_BUCKET: R2Bucket;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

export {};
