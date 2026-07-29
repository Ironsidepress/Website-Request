import { z } from 'zod';

import { handleApi, requirePrincipal } from '@/lib/api';
import { getServices } from '@/lib/services';

const submitInputSchema = z.object({ confirmAccuracy: z.boolean() });

/**
 * Strict full-document validation → intake freeze → project creation.
 * Idempotent: double submission returns the existing project (no duplicates).
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleApi(request, async () => {
    const principal = await requirePrincipal(request);
    const { id } = await context.params;
    const input = submitInputSchema.parse(await request.json());
    const { projects } = await getServices();
    const result = await projects.submitIntake(principal, id, input);
    return Response.json(result, { status: result.alreadySubmitted ? 200 : 201 });
  });
}
