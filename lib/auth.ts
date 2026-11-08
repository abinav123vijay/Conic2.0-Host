import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
export const SESSION_COOKIE = 'conic_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export type UserRole = 'owner' | 'viewer';

export type AuthUser = {
  id: string;
  email: string;
  businessId: string;
  role: UserRole;
};

type Session = AuthUser & { expiresAt: number };

function getSessionSecret() {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('Set AUTH_SESSION_SECRET to a random value of at least 32 characters.');
  return secret;
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, saltHex, hashHex] = encoded.split('$');
  if (algorithm !== 'scrypt' || !saltHex || !hashHex || !/^[a-f0-9]+$/i.test(saltHex) || !/^[a-f0-9]+$/i.test(hashHex)) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, salt, expected.length) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function sign(value: string) {
  return createHmac('sha256', getSessionSecret()).update(value).digest('base64url');
}

export function createSessionToken(user: AuthUser) {
  const payload: Session = { ...user, expiresAt: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded)}`;
}

export function readSessionToken(token: string | undefined): AuthUser | null {
  if (!token) return null;
  try {
    const [encoded, signature, extra] = token.split('.');
    if (!encoded || !signature || extra) return null;
    const expected = Buffer.from(sign(encoded));
    const received = Buffer.from(signature);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
    const session = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as Session;
    if (!session.id || !session.email || session.businessId !== (process.env.CONIC_BUSINESS_ID || 'conic_truck2') || !['owner', 'viewer'].includes(session.role) || session.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    return { id: session.id, email: session.email, businessId: session.businessId, role: session.role };
  } catch {
    return null;
  }
}
