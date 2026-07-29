import { z } from 'zod';

/** File upload schemas (docs/security-model.md: allowlist, size caps, quotas). */

export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB per file
export const TENANT_STORAGE_QUOTA_BYTES = 500 * 1024 * 1024; // 500 MB per organization

/** Server-side allowlist — anything else is rejected before a slot is issued. */
export const ALLOWED_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'image/heic',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
] as const;

/** Only images are ever eligible for inline display; everything else downloads
 *  as an attachment. SVG is deliberately excluded (script-capable). */
export const INLINE_DISPLAY_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

// Mirrors FILE_PURPOSES in @website-factory/db (db does not depend on schemas).
export const filePurposeSchema = z.enum(['logo', 'brand_guide', 'photo', 'copy_document', 'other']);

export const requestUploadInputSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z.enum(ALLOWED_CONTENT_TYPES),
  sizeBytes: z.number().int().min(1).max(MAX_FILE_BYTES),
  purpose: filePurposeSchema,
});
export type RequestUploadInput = z.infer<typeof requestUploadInputSchema>;
