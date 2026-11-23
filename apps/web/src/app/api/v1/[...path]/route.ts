import { type NextRequest, NextResponse } from 'next/server';
import { getDemoBackend } from '@/lib/demo-backend';

const REFRESH_COOKIE = 'qc_refresh';

async function dispatch(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await context.params;
  let body: unknown = null;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    body = await request.json().catch(() => null);
  }

  const result = getDemoBackend().handle({
    method: request.method,
    segments: path,
    query: request.nextUrl.searchParams,
    body,
    authorization: request.headers.get('authorization'),
    sessionToken: request.headers.get('x-session-token'),
    refreshCookie: request.cookies.get(REFRESH_COOKIE)?.value ?? null,
  });

  const response =
    result.status === 204
      ? new NextResponse(null, { status: 204 })
      : NextResponse.json(result.body, { status: result.status });

  if (result.setRefreshCookie !== undefined) {
    if (result.setRefreshCookie === null) {
      response.cookies.set(REFRESH_COOKIE, '', {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 0,
      });
    } else {
      response.cookies.set(REFRESH_COOKIE, result.setRefreshCookie, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 24 * 60 * 60,
      });
    }
  }

  return response;
}

export const GET = dispatch;
export const POST = dispatch;
export const PATCH = dispatch;
export const PUT = dispatch;
export const DELETE = dispatch;
