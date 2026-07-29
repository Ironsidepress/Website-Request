import { z } from 'zod';

/**
 * Draft autosave input guard.
 *
 * Drafts must accept half-typed answers, so field-level validation cannot be
 * strict while editing. Instead, the boundary enforces structural safety —
 * plain JSON data, bounded size, bounded depth — and strict validation runs
 * continuously to produce the validity map (document.ts). Nothing oversized
 * or non-JSON ever reaches storage, satisfying "validate all external input"
 * without rejecting work in progress.
 */

export const MAX_SECTION_BYTES = 32 * 1024;
const MAX_DEPTH = 8;
const MAX_KEYS_PER_OBJECT = 100;
const MAX_ARRAY_LENGTH = 200;
const MAX_STRING_LENGTH = 4000;

function checkNode(value: unknown, depth: number, ctx: z.RefinementCtx, path: string): void {
  if (depth > MAX_DEPTH) {
    ctx.addIssue({ code: 'custom', message: `Too deeply nested at ${path}` });
    return;
  }
  if (typeof value === 'string') {
    if (value.length > MAX_STRING_LENGTH) {
      ctx.addIssue({ code: 'custom', message: `Text too long at ${path}` });
    }
    return;
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return;
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LENGTH) {
      ctx.addIssue({ code: 'custom', message: `Too many entries at ${path}` });
      return;
    }
    value.forEach((item, index) => checkNode(item, depth + 1, ctx, `${path}[${index}]`));
    return;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > MAX_KEYS_PER_OBJECT) {
      ctx.addIssue({ code: 'custom', message: `Too many fields at ${path}` });
      return;
    }
    for (const [key, child] of entries) {
      if (key.length > 128) {
        ctx.addIssue({ code: 'custom', message: `Field name too long at ${path}` });
        return;
      }
      checkNode(child, depth + 1, ctx, path ? `${path}.${key}` : key);
    }
    return;
  }
  // functions/symbols/undefined cannot appear in parsed JSON, but reject defensively.
  ctx.addIssue({ code: 'custom', message: `Unsupported value at ${path}` });
}

/** A single section's draft payload: a bounded, plain JSON object. */
export const sectionDraftSchema = z
  .record(z.string().max(128), z.unknown())
  .superRefine((value, ctx) => {
    const serialized = JSON.stringify(value);
    if (serialized.length > MAX_SECTION_BYTES) {
      ctx.addIssue({ code: 'custom', message: 'Section draft is too large' });
      return;
    }
    checkNode(value, 0, ctx, '');
  });

export type SectionDraft = z.infer<typeof sectionDraftSchema>;

/** Autosave request body. */
export const saveSectionInputSchema = z.object({
  baseRevision: z.number().int().min(0),
  data: sectionDraftSchema,
});
export type SaveSectionInput = z.infer<typeof saveSectionInputSchema>;
