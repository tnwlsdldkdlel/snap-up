import { NextResponse, type NextRequest } from 'next/server';
import { checkBasicAuth } from './lib/auth';

export function proxy(req: NextRequest) {
  const result = checkBasicAuth(req.headers.get('authorization'), process.env.APP_ID, process.env.APP_PASSWORD);
  if (result === 'ok') return NextResponse.next();
  if (result === 'misconfigured') return new NextResponse('APP_ID or APP_PASSWORD not set', { status: 503 });
  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="snap-up", charset="UTF-8"' },
  });
}

export const config = { matcher: '/((?!_next/static|_next/image|favicon.ico).*)' };
