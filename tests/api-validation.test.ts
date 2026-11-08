import assert from 'node:assert/strict';
import test from 'node:test';
import { POST as postDaily } from '../app/api/daily/route';
import { POST as postPurchases } from '../app/api/purchases/route';
import { PUT as saveRent } from '../app/api/finance/rent/route';
import { PUT as saveDistribution } from '../app/api/finance/partner-payments/route';
import { authenticatedRequest } from './helpers/auth-request';

async function error(response: Response) {
  return response.json() as Promise<{ error?: string }>;
}

test('daily and purchase APIs validate transaction dates after authorization', async () => {
  const daily = await postDaily(authenticatedRequest('http://localhost/api/daily', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  }));
  assert.equal(daily.status, 400);
  assert.match((await error(daily)).error || '', /date is required/i);

  const purchase = await postPurchases(authenticatedRequest('http://localhost/api/purchases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  }));
  assert.equal(purchase.status, 400);
  assert.match((await error(purchase)).error || '', /purchaseDate is required/i);
});

test('rent and partner distribution APIs reject unconfirmed or invalid amounts and splits', async () => {
  const rent = await saveRent(authenticatedRequest('http://localhost/api/finance/rent', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ period: '2026-10', amount: 0, paymentDate: '2026-10-01', status: 'pending', notes: '' })
  }));
  assert.equal(rent.status, 400);

  const distribution = await saveDistribution(authenticatedRequest('http://localhost/api/finance/partner-payments', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ period: '2026-10', approvedAmount: 1000, investor1Percent: 50, investor2Percent: 40 })
  }));
  assert.equal(distribution.status, 400);
});

test('viewer writes are denied before request data is processed', async () => {
  const response = await postDaily(authenticatedRequest('http://localhost/api/daily', {
    method: 'POST',
    body: 'not-json'
  }, 'viewer'));
  assert.equal(response.status, 403);
});
