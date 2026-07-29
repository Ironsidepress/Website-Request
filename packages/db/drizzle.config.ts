import { defineConfig } from 'drizzle-kit';

/**
 * Migration generation only (`pnpm --filter @website-factory/db generate`).
 * Migrations are applied with `wrangler d1 migrations apply` per environment
 * (docs/environments.md) and with `applyD1Migrations` in tests — never by
 * drizzle-kit directly.
 */
export default defineConfig({
  dialect: 'sqlite',
  driver: 'd1-http',
  schema: './src/schema/index.ts',
  out: './migrations',
});
