import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { proxy } from '../proxy';
import { authHeaders } from './helpers/auth-request';

function request(path: string, role?: 'owner' | 'viewer', method = 'GET') {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: role ? authHeaders(role) : undefined
  });
}

test('owner-only APIs accept owners and reject unauthenticated and viewer sessions', () => {
  const ownerOnlyRequests = [
    ['/api/finance/rent', 'GET'],
    ['/api/finance/savings', 'GET'],
    ['/api/finance/savings', 'PUT'],
    ['/api/finance/partner-payments', 'PUT'],
    ['/api/settings', 'PUT'],
    ['/api/reconciliation?date=2026-10-08', 'GET'],
    ['/api/excel/export', 'GET']
  ] as const;

  for (const [path, method] of ownerOnlyRequests) {
    const ownerResponse = proxy(request(path, 'owner', method));
    assert.equal(ownerResponse.headers.get('x-middleware-next'), '1', `owner should pass ${method} ${path}`);

    const unauthenticatedResponse = proxy(request(path, undefined, method));
    assert.equal(unauthenticatedResponse.status, 401, `unauthenticated request should fail ${method} ${path}`);

    const viewerResponse = proxy(request(path, 'viewer', method));
    assert.equal(viewerResponse.status, 403, `viewer should fail ${method} ${path}`);
  }
});

test('viewers can read approved pages and APIs but cannot write entries or access balances', () => {
  for (const path of ['/overview', '/dashboard/monthly', '/dashboard/yearly', '/entries/daily', '/entries/purchases']) {
    assert.equal(proxy(request(path, 'viewer')).headers.get('x-middleware-next'), '1');
  }
  for (const path of ['/finance', '/finance/rent', '/finance/partner-payments', '/finance/savings', '/settings', '/dashboard/reconciliation', '/import-export']) {
    assert.equal(proxy(request(path, 'viewer')).status, 307);
  }

  assert.equal(proxy(request('/api/daily', 'viewer')).headers.get('x-middleware-next'), '1');
  assert.equal(proxy(request('/api/purchases', 'viewer')).headers.get('x-middleware-next'), '1');
  assert.equal(proxy(request('/api/daily', 'viewer', 'POST')).status, 403);
  assert.equal(proxy(request('/api/purchases/entry-1', 'viewer', 'DELETE')).status, 403);
  assert.equal(proxy(request('/api/dashboard/balance?date=2026-10-08', 'viewer')).status, 403);
});
