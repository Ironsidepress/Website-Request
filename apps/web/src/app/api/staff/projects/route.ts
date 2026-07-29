import { handleApi, requirePrincipal } from '@/lib/api';
import { getServices } from '@/lib/services';

/** Cross-tenant project table for staff; every read is audit-logged. */
export async function GET(request: Request): Promise<Response> {
  return handleApi(request, async () => {
    const principal = await requirePrincipal(request);
    const url = new URL(request.url);
    const { staff } = await getServices();
    return Response.json(
      await staff.listProjects(principal, {
        ...(url.searchParams.get('status') ? { status: url.searchParams.get('status')! } : {}),
        ...(url.searchParams.get('health') ? { health: url.searchParams.get('health')! } : {}),
      }),
    );
  });
}
