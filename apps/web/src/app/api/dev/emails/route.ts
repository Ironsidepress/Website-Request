import { handleApi } from '@/lib/api';
import { lastDevEmailTo } from '@/lib/dev-inbox';
import { getServices } from '@/lib/services';

/**
 * Development-only inbox: lets local testing and the E2E suite retrieve
 * verification/invitation links. Hard-404s outside APP_ENV=development —
 * staging and production never expose captured email.
 */
export async function GET(request: Request): Promise<Response> {
  return handleApi(request, async () => {
    const { env } = await getServices();
    if (env.APP_ENV !== 'development') {
      return new Response('Not found', { status: 404 });
    }
    const to = new URL(request.url).searchParams.get('to');
    if (!to)
      return Response.json({ code: 'validation_failed', message: 'to required' }, { status: 400 });
    const email = lastDevEmailTo(to);
    if (!email) return new Response('Not found', { status: 404 });
    return Response.json(email);
  });
}
