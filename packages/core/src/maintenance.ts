import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { createDb } from '@website-factory/db';

import { AuditService } from './audit';
import { systemClock, type Clock } from './clock';
import { FileService } from './services/files';
import { OrganizationService } from './services/organizations';

/**
 * Maintenance entry point for the orchestrator worker's scheduled jobs.
 * Deliberately excludes the auth graph — importing via
 * `@website-factory/core/maintenance` keeps the orchestrator bundle small and
 * free of web-only dependencies.
 */
export function createMaintenance(config: { d1: D1Database; r2: R2Bucket; clock?: Clock }) {
  const clock = config.clock ?? systemClock;
  const db = createDb(config.d1);
  const audit = new AuditService(db, clock);
  const organizations = new OrganizationService(db, clock, audit);
  const files = new FileService(db, config.r2, clock, audit, organizations);

  return {
    /** Sweeps upload slots that never received content (docs/user-flows.md §3). */
    cleanupOrphanUploads: () => files.cleanupOrphans(),
  };
}
