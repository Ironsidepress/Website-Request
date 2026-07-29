import { acceptInvitationInputSchema } from '@website-factory/schemas';

import { handleApi, requirePrincipal } from '@/lib/api';
import { getServices } from '@/lib/services';

export async function POST(request: Request): Promise<Response> {
  return handleApi(request, async () => {
    const principal = await requirePrincipal(request);
    const input = acceptInvitationInputSchema.parse(await request.json());
    const { invitations } = await getServices();
    const result = await invitations.accept(principal, input.token);
    return Response.json(result);
  });
}
