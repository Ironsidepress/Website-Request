import { handleApi, requirePrincipal } from '@/lib/api';
import { getServices } from '@/lib/services';

/** Cross-tenant pending-approvals queue for staff. */
export async function GET(request: Request): Promise<Response> {
  return handleApi(request, async () => {
    const principal = await requirePrincipal(request);
    const { staff } = await getServices();
    return Response.json(await staff.listPendingApprovals(principal));
  });
}
