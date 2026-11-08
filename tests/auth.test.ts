import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { createSessionToken, hashPassword, readSessionToken, verifyPassword } from '../lib/auth';

const owner = { id: 'owner-1', email: 'owner@example.test', businessId: 'conic_truck2', role: 'owner' as const };

test('password hashes verify the original password and reject a different one', async () => {
  const encoded = await hashPassword('correct horse battery staple');
  assert.equal(await verifyPassword('correct horse battery staple', encoded), true);
  assert.equal(await verifyPassword('incorrect password', encoded), false);
  assert.equal(await verifyPassword('password', 'not-a-hash'), false);
});

test('signed sessions preserve role and reject absent, malformed or tampered tokens', () => {
  const token = createSessionToken(owner);
  assert.deepEqual(readSessionToken(token), owner);
  assert.equal(readSessionToken(undefined), null);
  assert.equal(readSessionToken('bad.token.value'), null);

  const [payload, signature] = token.split('.');
  const changedPayload = `${payload.slice(0, -1)}${payload.endsWith('a') ? 'b' : 'a'}`;
  assert.equal(readSessionToken(`${changedPayload}.${signature}`), null);
});

test('expired signed sessions are rejected', () => {
  const payload = Buffer.from(JSON.stringify({ ...owner, expiresAt: 1 })).toString('base64url');
  const signature = createHmac('sha256', process.env.AUTH_SESSION_SECRET!)
    .update(payload)
    .digest('base64url');
  assert.equal(readSessionToken(`${payload}.${signature}`), null);
});
