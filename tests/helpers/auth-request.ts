import { createSessionToken, SESSION_COOKIE, type UserRole } from '../../lib/auth';
import { BUSINESS_ID } from '../../lib/constants';

export function authHeaders(role: UserRole = 'owner') {
  const token = createSessionToken({
    id: `${role}-test-user`,
    email: `${role}@example.test`,
    businessId: BUSINESS_ID,
    role
  });
  return { cookie: `${SESSION_COOKIE}=${token}` };
}

export function authenticatedRequest(url: string, init: RequestInit = {}, role: UserRole = 'owner') {
  const headers = new Headers(init.headers);
  headers.set('cookie', authHeaders(role).cookie);
  return new Request(url, { ...init, headers });
}
