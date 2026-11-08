import { NextRequest, NextResponse } from 'next/server';
import { readSessionToken, SESSION_COOKIE } from '@/lib/auth';

export function GET(request: NextRequest) {
  let user = null;
  try {
    user = readSessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  } catch {
    user = null;
  }
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  return NextResponse.json({ email: user.email, role: user.role });
}
