import { z } from 'zod';

import { handleApi, requirePrincipal } from '@/lib/api';
import { getServices } from '@/lib/services';

const actionInputSchema = z.object({
  action: z.enum(['hold', 'resume', 'cancel', 'retry']),
  reason: z.string().max(2000).optional(),
});

/** Audited manual actions (acceptance §5): guarded transitions only. */
export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  return handleApi(request, async () => {
    const principal = await requirePrincipal(request);
    const { projectId } = await context.params;
    const input = actionInputSchema.parse(await request.json());
    const { staff } = await getServices();
    return Response.json(await staff.performAction(principal, projectId, input));
  });
}
