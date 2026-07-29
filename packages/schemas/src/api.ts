import { z } from 'zod';

/** API request schemas (M1 surface). All external input is validated with these. */

export const createOrganizationInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  contactEmail: z.email().max(254),
  phone: z.string().trim().max(30).optional(),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationInputSchema>;

export const createMemberInvitationInputSchema = z.object({
  email: z.email().max(254),
  role: z.literal('member'),
});
export type CreateMemberInvitationInput = z.infer<typeof createMemberInvitationInputSchema>;

export const createStaffInvitationInputSchema = z.object({
  email: z.email().max(254),
  role: z.enum(['admin', 'reviewer', 'operator']),
});
export type CreateStaffInvitationInput = z.infer<typeof createStaffInvitationInputSchema>;

export const acceptInvitationInputSchema = z.object({
  token: z
    .string()
    .min(32)
    .max(200)
    .regex(/^[a-f0-9]+$/, 'malformed invitation token'),
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationInputSchema>;

/** Safe client-facing error envelope (docs/security-model.md). */
export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  correlationId: z.string().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
