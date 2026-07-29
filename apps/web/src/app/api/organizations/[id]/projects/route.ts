import { handleApi, requirePrincipal } from '@/lib/api';
import { getServices } from '@/lib/services';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleApi(request, async () => {
    const principal = await requirePrincipal(request);
    const { id } = await context.params;
    const { projects } = await getServices();
    return Response.json(await projects.listForOrganization(principal, id));
  });
}
