import { getServices } from '@/lib/services';

/**
 * Mounts the AuthService's HTTP endpoints (sign-up, sign-in, sign-out, email
 * verification, password reset). Rate limiting and abuse protection are
 * enforced inside the auth layer (ADR-0003).
 */
export async function GET(request: Request): Promise<Response> {
  const { auth } = await getServices();
  return auth.handleRequest(request);
}

export async function POST(request: Request): Promise<Response> {
  const { auth } = await getServices();
  return auth.handleRequest(request);
}
