import { createStaffInvitationInputSchema } from '@website-factory/schemas';

import { handleApi, requirePrincipal } from '@/lib/api';
import { getServices } from '@/lib/services';

/** Staff accounts are invitation-only; only administrators may invite (ADR-0003). */
export async function POST(request: Request): Promise<Response> {
  return handleApi(request, async () => {
    const principal = await requirePrincipal(request);
    const input = createStaffInvitationInputSchema.parse(await request.json());
    const { invitations } = await getServices();
    const result = await invitations.inviteStaff(principal, input);
    return Response.json(result, { status: 201 });
  });
}
