import { handleApi, requirePrincipal } from '@/lib/api';
import { getServices } from '@/lib/services';

/**
 * Receives the file bytes for a previously issued upload slot (ADR-0008 as
 * amended: worker-proxied transport, 25 MB cap enforced in the service).
 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string; fileId: string }> },
): Promise<Response> {
  return handleApi(request, async () => {
    const principal = await requirePrincipal(request);
    const { id, fileId } = await context.params;
    const content = await request.arrayBuffer();
    const { files } = await getServices();
    const stored = await files.storeContent(
      principal,
      id,
      fileId,
      content,
      request.headers.get('content-type'),
    );
    return Response.json(stored);
  });
}
