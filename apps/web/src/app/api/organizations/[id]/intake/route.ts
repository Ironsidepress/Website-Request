import { handleApi, requirePrincipal } from '@/lib/api';
import { getServices } from '@/lib/services';

/** Returns the organization's intake draft, creating it on first access. */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleApi(request, async () => {
    const principal = await requirePrincipal(request);
    const { id } = await context.params;
    const { intake } = await getServices();
    const view = await intake.getOrCreateDraft(principal, id);
    return Response.json(view);
  });
}
