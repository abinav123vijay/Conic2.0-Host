import { NextResponse } from 'next/server';
import { readSessionToken, SESSION_COOKIE, type AuthUser, type UserRole } from '@/lib/auth';

export function getRequestUser(request: Request): AuthUser | null {
  const cookieHeader = request.headers.get('cookie') || '';
  const cookie = cookieHeader.split(';').map(value => value.trim()).find(value => value.startsWith(`${SESSION_COOKIE}=`));
  return readSessionToken(cookie?.slice(SESSION_COOKIE.length + 1));
}

export function authorize(request: Request, allowedRole: UserRole = 'owner'): NextResponse | null {
  const user = getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  if (allowedRole === 'owner' && user.role !== 'owner') {
    return NextResponse.json({ error: 'This section is available to owners only.' }, { status: 403 });
  }
  return null;
}
