import { handleApi, requirePrincipal } from '@/lib/api';
import { getServices } from '@/lib/services';

/** Pending approval gates for the client timeline (safe fields only). */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; projectId: string }> },
): Promise<Response> {
  return handleApi(request, async () => {
    const principal = await requirePrincipal(request);
    const { id, projectId } = await context.params;
    const { approvals } = await getServices();
    return Response.json(await approvals.listPendingForProject(principal, id, projectId));
  });
}
