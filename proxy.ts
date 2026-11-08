import { NextRequest, NextResponse } from 'next/server';
import { readSessionToken, SESSION_COOKIE } from '@/lib/auth';

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname === '/api/health' || pathname.startsWith('/api/auth/')) return NextResponse.next();

  let session = null;
  try {
    session = readSessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  } catch {
    session = null;
  }

  if (!session) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  const isApi = pathname.startsWith('/api/');
  if (session.role === 'owner') {
    if (pathname === '/') return NextResponse.redirect(new URL('/dashboard/monthly', request.url));
    return NextResponse.next();
  }

  const viewerPages = pathname === '/' || pathname.startsWith('/overview') ||
    pathname.startsWith('/dashboard/monthly') || pathname.startsWith('/dashboard/yearly') ||
    pathname.startsWith('/entries/daily') || pathname.startsWith('/entries/purchases');
  const viewerApis = request.method === 'GET' && (
    pathname === '/api/dashboard/monthly' || pathname === '/api/dashboard/yearly' ||
    pathname === '/api/daily' || pathname === '/api/purchases'
  );
  if (isApi) {
    return viewerApis
      ? NextResponse.next()
      : NextResponse.json({ error: 'This account does not have access to this resource.' }, { status: 403 });
  }
  if (viewerPages) {
    if (pathname === '/') return NextResponse.redirect(new URL('/overview', request.url));
    return NextResponse.next();
  }
  return NextResponse.redirect(new URL('/overview?access=restricted', request.url));
}

export const config = {
  matcher: ['/', '/overview/:path*', '/dashboard/:path*', '/finance/:path*', '/entries/:path*', '/settings/:path*', '/import-export/:path*', '/api/:path*']
};