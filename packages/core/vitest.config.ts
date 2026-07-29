import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Integration tests run inside workerd with a real (Miniflare) D1 database.
 * Migrations from packages/db are applied in test/setup.ts, so the tests
 * exercise the exact SQL that ships to staging/production.
 */
export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(here, '../db/migrations'));
  return {
    plugins: [
      cloudflareTest({
        miniflare: {
          compatibilityDate: '2026-07-01',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: ['DB'],
          bindings: { TEST_MIGRATIONS: migrations },
        },
      }),
    ],
    test: {
      include: ['test/**/*.spec.ts', 'src/**/*.test.ts'],
      setupFiles: ['./test/setup.ts'],
    },
  };
});
