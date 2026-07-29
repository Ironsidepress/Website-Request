import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import type { D1Database } from '@cloudflare/workers-types';

import * as schema from './schema';

export type Database = DrizzleD1Database<typeof schema>;

/** The only way to obtain a database handle — always carries the full schema. */
export function createDb(d1: D1Database): Database {
  return drizzle(d1, { schema, casing: 'snake_case' });
}
