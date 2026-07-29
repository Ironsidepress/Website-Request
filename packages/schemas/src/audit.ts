import { z } from 'zod';

/**
 * Audit-log schemas (docs/data-model.md, docs/security-model.md).
 *
 * Audit metadata must never contain secrets, credentials or prompt text.
 * This is enforced structurally: metadata is a flat record of short scalar
 * values, and keys that look credential-like are rejected outright.
 */

const FORBIDDEN_METADATA_KEY =
  /(secret|password|passwd|credential|token|api[_-]?key|authorization|cookie|session[_-]?id|private[_-]?key|prompt)/i;

export const auditActionSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/,
    'audit actions are dot-separated snake_case, e.g. "auth.login" or "organization.created"',
  );

export const auditMetadataSchema = z
  .record(z.string().max(64), z.union([z.string().max(500), z.number(), z.boolean(), z.null()]))
  .superRefine((record, ctx) => {
    for (const key of Object.keys(record)) {
      if (FORBIDDEN_METADATA_KEY.test(key)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `audit metadata key "${key}" looks credential-like and is not allowed`,
        });
      }
    }
  });

export type AuditMetadata = z.infer<typeof auditMetadataSchema>;

export const auditEventSchema = z.object({
  action: auditActionSchema,
  resourceType: z.string().min(1).max(64),
  resourceId: z.string().min(1).max(128),
  organizationId: z.string().min(1).max(128).nullable(),
  actor: z.object({
    type: z.enum(['user', 'agent', 'system']),
    id: z.string().min(1).max(128),
  }),
  ipAddress: z.string().max(64).optional(),
  metadata: auditMetadataSchema.optional(),
});

export type AuditEvent = z.infer<typeof auditEventSchema>;
