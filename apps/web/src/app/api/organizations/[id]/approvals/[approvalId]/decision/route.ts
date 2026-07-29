import { z } from 'zod';

import { handleApi, requirePrincipal } from '@/lib/api';
import { getServices } from '@/lib/services';

const decisionInputSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().max(2000).optional(),
});

/**
 * Records a human approval decision (ADR-0010). This route is the sole
 * writer of decisions: the ApprovalService checks the gate's authority
 * matrix, records the single winning decision with an audit entry, and then
 * wakes the paused workflow — which re-verifies the row in D1.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; approvalId: string }> },
): Promise<Response> {
  return handleApi(request, async () => {
    const principal = await requirePrincipal(request);
    const { id, approvalId } = await context.params;
    const input = decisionInputSchema.parse(await request.json());
    const { approvals } = await getServices();
    return Response.json(await approvals.decide(principal, id, approvalId, input));
  });
}
