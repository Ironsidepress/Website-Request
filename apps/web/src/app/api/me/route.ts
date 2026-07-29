import { handleApi, requirePrincipal } from '@/lib/api';
import { getServices } from '@/lib/services';

export async function GET(request: Request): Promise<Response> {
  return handleApi(request, async () => {
    const principal = await requirePrincipal(request);
    const { organizations } = await getServices();
    const memberships = await organizations.listForPrincipal(principal);
    return Response.json({
      user: {
        id: principal.userId,
        email: principal.email,
        name: principal.name,
        emailVerified: principal.emailVerified,
        platformRole: principal.platformRole,
      },
      organizations: memberships.map(({ organization, role }) => ({
        id: organization.id,
        name: organization.name,
        role,
      })),
    });
  });
}
