import { requestUploadInputSchema } from '@website-factory/schemas';

import { handleApi, requirePrincipal } from '@/lib/api';
import { getServices } from '@/lib/services';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleApi(request, async () => {
    const principal = await requirePrincipal(request);
    const { id } = await context.params;
    const { files } = await getServices();
    return Response.json(await files.listForOrganization(principal, id));
  });
}

/** Issues an upload slot after allowlist/size/quota validation. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleApi(request, async () => {
    const principal = await requirePrincipal(request);
    const { id } = await context.params;
    const input = requestUploadInputSchema.parse(await request.json());
    const { files } = await getServices();
    const slot = await files.requestUpload(principal, id, input);
    return Response.json(slot, { status: 201 });
  });
}
