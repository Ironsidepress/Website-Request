import { createOrganizationInputSchema } from '@website-factory/schemas';

import { handleApi, requirePrincipal } from '@/lib/api';
import { getServices } from '@/lib/services';

export async function GET(request: Request): Promise<Response> {
  return handleApi(request, async () => {
    const principal = await requirePrincipal(request);
    const { organizations } = await getServices();
    const memberships = await organizations.listForPrincipal(principal);
    return Response.json(
      memberships.map(({ organization, role }) => ({
        id: organization.id,
        name: organization.name,
        contactEmail: organization.contactEmail,
        role,
      })),
    );
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleApi(request, async () => {
    const principal = await requirePrincipal(request);
    const input = createOrganizationInputSchema.parse(await request.json());
    const { organizations } = await getServices();
    const organization = await organizations.create(principal, input);
    return Response.json({ id: organization.id, name: organization.name }, { status: 201 });
  });
}
