import assert from 'node:assert/strict';
import test from 'node:test';
import { POST as login } from '../app/api/auth/login/route';
import { POST as signup } from '../app/api/auth/signup/route';
import { readSessionToken, SESSION_COOKIE } from '../lib/auth';
import { BUSINESS_ID } from '../lib/constants';
import { installInMemoryMongo } from './helpers/in-memory-mongodb';

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function inviteEnvironment() {
  const previous = {
    owner: process.env.AUTH_OWNER_SIGNUP_CODE,
    viewer: process.env.AUTH_VIEWER_SIGNUP_CODE
  };
  process.env.AUTH_OWNER_SIGNUP_CODE = 'truck-two-owner-test-code';
  process.env.AUTH_VIEWER_SIGNUP_CODE = 'truck-two-viewer-test-code';
  return () => {
    if (previous.owner === undefined) delete process.env.AUTH_OWNER_SIGNUP_CODE;
    else process.env.AUTH_OWNER_SIGNUP_CODE = previous.owner;
    if (previous.viewer === undefined) delete process.env.AUTH_VIEWER_SIGNUP_CODE;
    else process.env.AUTH_VIEWER_SIGNUP_CODE = previous.viewer;
  };
}

function sessionRole(response: Response) {
  const cookie = response.headers.get('set-cookie') || '';
  const token = new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(cookie)?.[1];
  return readSessionToken(token)?.role;
}

test('signup assigns only the invite-code role and caps Truck 2 at two users per role', async () => {
  const restoreMongo = installInMemoryMongo();
  const restoreEnvironment = inviteEnvironment();
  try {
    const invalidCode = await signup(jsonRequest('http://localhost/api/auth/signup', {
      email: 'unknown@example.test', password: 'a-long-test-password', inviteCode: 'not-an-invite'
    }));
    assert.equal(invalidCode.status, 403);
    assert.equal(restoreMongo.documents('users').length, 0);

    const registrations = [
      { email: 'Owner.One@example.test', inviteCode: 'truck-two-owner-test-code', role: 'owner' },
      { email: 'owner.two@example.test', inviteCode: 'truck-two-owner-test-code', role: 'owner' },
      { email: 'viewer.one@example.test', inviteCode: 'truck-two-viewer-test-code', role: 'viewer' },
      { email: 'viewer.two@example.test', inviteCode: 'truck-two-viewer-test-code', role: 'viewer' }
    ];
    for (const [index, registration] of registrations.entries()) {
      const response = await signup(jsonRequest('http://localhost/api/auth/signup', {
        ...registration,
        password: `a-long-test-password-${index}`
      }));
      assert.equal(response.status, 201);
      assert.equal(sessionRole(response), registration.role);
    }

    const users = restoreMongo.documents('users');
    assert.equal(users.length, 4);
    assert.ok(users.every(user => user.businessId === BUSINESS_ID));
    assert.deepEqual(users.map(user => user.role).sort(), ['owner', 'owner', 'viewer', 'viewer']);
    assert.equal(users[0].email, 'owner.one@example.test');
    assert.ok(users.every(user => typeof user.passwordHash === 'string'));

    for (const registration of [
      { email: 'owner.third@example.test', inviteCode: 'truck-two-owner-test-code' },
      { email: 'viewer.third@example.test', inviteCode: 'truck-two-viewer-test-code' }
    ]) {
      const response = await signup(jsonRequest('http://localhost/api/auth/signup', {
        ...registration, password: 'a-long-test-password'
      }));
      assert.equal(response.status, 409);
    }
    assert.equal(users.length, 4);
  } finally {
    restoreEnvironment();
    restoreMongo.restore();
  }
});

test('login issues owner and viewer sessions only for Truck 2 users with valid passwords', async () => {
  const mongo = installInMemoryMongo();
  try {
    const ownerPasswordHash = await (await import('../lib/auth')).hashPassword('owner-test-password');
    const viewerPasswordHash = await (await import('../lib/auth')).hashPassword('viewer-test-password');
    mongo.documents('users').push(
      { _id: 'owner-id', businessId: BUSINESS_ID, email: 'owner@example.test', role: 'owner', passwordHash: ownerPasswordHash },
      { _id: 'viewer-id', businessId: BUSINESS_ID, email: 'viewer@example.test', role: 'viewer', passwordHash: viewerPasswordHash },
      { _id: 'other-business-id', businessId: 'other-business', email: 'other@example.test', role: 'owner', passwordHash: ownerPasswordHash }
    );

    for (const account of [
      { email: 'OWNER@example.test', password: 'owner-test-password', role: 'owner' },
      { email: 'viewer@example.test', password: 'viewer-test-password', role: 'viewer' }
    ]) {
      const response = await login(jsonRequest('http://localhost/api/auth/login', account));
      assert.equal(response.status, 200);
      assert.equal(sessionRole(response), account.role);
    }

    for (const credentials of [
      { email: 'owner@example.test', password: 'wrong-password' },
      { email: 'other@example.test', password: 'owner-test-password' }
    ]) {
      assert.equal((await login(jsonRequest('http://localhost/api/auth/login', credentials))).status, 401);
    }
  } finally {
    mongo.restore();
  }
});
