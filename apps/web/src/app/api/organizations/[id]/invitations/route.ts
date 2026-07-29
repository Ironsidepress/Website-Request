import { createMemberInvitationInputSchema } from '@website-factory/schemas';

import { handleApi, requirePrincipal } from '@/lib/api';
import { getServices } from '@/lib/services';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleApi(request, async () => {
    const principal = await requirePrincipal(request);
    const { id } = await context.params;
    const { invitations } = await getServices();
    const rows = await invitations.listForOrganization(principal, id);
    return Response.json(
      rows.map((row) => ({
        id: row.id,
        email: row.email,
        role: row.role,
        status: row.status,
        expiresAt: row.expiresAt,
      })),
    );
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleApi(request, async () => {
    const principal = await requirePrincipal(request);
    const { id } = await context.params;
    const input = createMemberInvitationInputSchema.parse(await request.json());
    const { invitations } = await getServices();
    const result = await invitations.inviteMember(principal, id, input);
    return Response.json(result, { status: 201 });
  });
}
