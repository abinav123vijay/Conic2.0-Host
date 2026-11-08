import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { BUSINESS_ID } from '@/lib/constants';
import { createSessionToken, hashPassword, SESSION_COOKIE, SESSION_TTL_SECONDS } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';

function matchesInviteCode(input: string, expected: string) {
  const inputBuffer = Buffer.from(input);
  const expectedBuffer = Buffer.from(expected);
  return inputBuffer.length === expectedBuffer.length && timingSafeEqual(inputBuffer, expectedBuffer);
}

export async function POST(request: Request) {
  let body: { email?: unknown; password?: unknown; inviteCode?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Enter your email, password, and invite code.' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const inviteCode = typeof body.inviteCode === 'string' ? body.inviteCode : '';
  const roleInvites = [
    { role: 'owner' as const, code: process.env.AUTH_OWNER_SIGNUP_CODE },
    { role: 'viewer' as const, code: process.env.AUTH_VIEWER_SIGNUP_CODE }
  ].filter((invite): invite is { role: 'owner' | 'viewer'; code: string } => Boolean(invite.code));
  if (roleInvites.length === 0) return NextResponse.json({ error: 'Sign-up is not enabled. Ask the administrator to configure invite codes.' }, { status: 503 });
  if (new Set(roleInvites.map(invite => invite.code)).size !== roleInvites.length) {
    return NextResponse.json({ error: 'Owner and viewer invite codes must be different.' }, { status: 503 });
  }
  const role = roleInvites.find(invite => matchesInviteCode(inviteCode, invite.code))?.role;
  if (!role) return NextResponse.json({ error: 'Invite code is invalid.' }, { status: 403 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }
  if (password.length < 12 || password.length > 1024) {
    return NextResponse.json({ error: 'Use a password between 12 and 1024 characters.' }, { status: 400 });
  }

  try {
    const db = await getDb();
    const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const users = db.collection('users');
    const existing = await users.findOne({ businessId: BUSINESS_ID, email: { $regex: `^${escapedEmail}$`, $options: 'i' } });
    if (existing) return NextResponse.json({ error: 'An account with that email already exists.' }, { status: 409 });
    const roleCount = await users.countDocuments({ businessId: BUSINESS_ID, role });
    if (roleCount >= 2) return NextResponse.json({ error: `Both ${role} accounts have already been provisioned.` }, { status: 409 });

    const result = await users.insertOne({
      email,
      passwordHash: await hashPassword(password),
      businessId: BUSINESS_ID,
      role,
      createdAt: new Date()
    });
    const token = createSessionToken({ id: result.insertedId.toString(), email, businessId: BUSINESS_ID, role });
    const response = NextResponse.json({ ok: true }, { status: 201 });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_SECONDS
    });
    return response;
  } catch (error) {
    console.error('Sign-up failed:', error instanceof Error ? error.name : 'Unknown error');
    return NextResponse.json({ error: 'Sign-up is temporarily unavailable.' }, { status: 503 });
  }
}
