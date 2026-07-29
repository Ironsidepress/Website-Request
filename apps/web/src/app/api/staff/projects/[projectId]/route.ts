import { handleApi, requirePrincipal } from '@/lib/api';
import { getServices } from '@/lib/services';

/** Full internal project view for staff (history, approvals, agent runs, audit). */
export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  return handleApi(request, async () => {
    const principal = await requirePrincipal(request);
    const { projectId } = await context.params;
    const { staff } = await getServices();
    return Response.json(await staff.projectDetail(principal, projectId));
  });
}
