import { handleApi, requirePrincipal } from '@/lib/api';
import { getServices } from '@/lib/services';

/** Client-facing timeline: stages + human-readable events, internals never. */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; projectId: string }> },
): Promise<Response> {
  return handleApi(request, async () => {
    const principal = await requirePrincipal(request);
    const { id, projectId } = await context.params;
    const { projects } = await getServices();
    return Response.json(await projects.timeline(principal, id, projectId));
  });
}
