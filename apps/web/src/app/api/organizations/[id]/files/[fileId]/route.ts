import { handleApi, requirePrincipal } from '@/lib/api';
import { getServices } from '@/lib/services';

/**
 * Authenticated, tenant-checked download. The bucket is never public; only
 * safe image types render inline, everything else downloads as an attachment.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; fileId: string }> },
): Promise<Response> {
  return handleApi(request, async () => {
    const principal = await requirePrincipal(request);
    const { id, fileId } = await context.params;
    const { files } = await getServices();
    const download = await files.download(principal, id, fileId);
    const encodedName = encodeURIComponent(download.fileName).replaceAll("'", '%27');
    return new Response(download.body, {
      headers: {
        'content-type': download.contentType,
        'content-length': String(download.sizeBytes),
        'content-disposition': `${download.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodedName}`,
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, no-store',
      },
    });
  });
}
