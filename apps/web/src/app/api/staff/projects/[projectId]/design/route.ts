import { z } from 'zod';

import { handleApi, requirePrincipal } from '@/lib/api';
import { getServices } from '@/lib/services';

const attachDesignSchema = z.object({
  fileKey: z.string().min(1).max(128),
  fileUrl: z.url({ protocol: /^https$/ }),
  nodeIds: z.array(z.string().min(1).max(128)).max(50).optional(),
  snapshotUrl: z.url({ protocol: /^https$/ }).optional(),
});

/**
 * Attaches an externally produced design as the project's next figma_design
 * artifact version (ADR-0017) and repoints a pending design_review gate at
 * it. Staff-only; audited by the service.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  return handleApi(request, async () => {
    const principal = await requirePrincipal(request);
    const { projectId } = await context.params;
    const input = attachDesignSchema.parse(await request.json());
    const { staff } = await getServices();
    return Response.json(await staff.attachDesign(principal, projectId, input), { status: 201 });
  });
}
