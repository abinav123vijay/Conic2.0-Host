import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { createSessionToken, SESSION_COOKIE, SESSION_TTL_SECONDS, verifyPassword } from '@/lib/auth';
import { BUSINESS_ID } from '@/lib/constants';

type UserRecord = {
  _id: unknown;
  email: string;
  passwordHash?: string;
  businessId: string;
  role: 'owner' | 'viewer';
};

export async function POST(request: Request) {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Enter your email and password.' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password || password.length > 1024) {
    return NextResponse.json({ error: 'Enter your email and password.' }, { status: 400 });
  }

  try {
    const db = await getDb();
    const user = await db.collection<UserRecord>('users').findOne({
      businessId: BUSINESS_ID,
      email: { $regex: `^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }
    });
    if (!user?.passwordHash || !['owner', 'viewer'].includes(user.role) || !(await verifyPassword(password, user.passwordHash))) {
      return NextResponse.json({ error: 'Email or password is incorrect.' }, { status: 401 });
    }

    const token = createSessionToken({
      id: String(user._id),
      email: user.email,
      businessId: BUSINESS_ID,
      role: user.role
    });
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_SECONDS
    });
    return response;
  } catch (error) {
    console.error('Login failed:', error instanceof Error ? error.name : 'Unknown error');
    return NextResponse.json({ error: 'Sign-in is temporarily unavailable.' }, { status: 503 });
  }
}
