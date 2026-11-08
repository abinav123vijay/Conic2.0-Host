import assert from 'node:assert/strict';
import test from 'node:test';
import { GET as listDaily, POST as createDaily } from '../app/api/daily/route';
import { DELETE as deleteDaily, PATCH as updateDaily } from '../app/api/daily/[id]/route';
import { GET as listPurchases, POST as createPurchase } from '../app/api/purchases/route';
import { DELETE as deletePurchase, PATCH as updatePurchase } from '../app/api/purchases/[id]/route';
import { authenticatedRequest } from './helpers/auth-request';
import { installInMemoryMongo } from './helpers/in-memory-mongodb';

const request = (url: string, method: string, body?: unknown) => authenticatedRequest(url, {
  method,
  headers: { 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
});
const context = (id: string) => ({ params: Promise.resolve({ id }) });

test('daily entries retain owner add, edit, list, and delete behavior', async () => {
  const mongo = installInMemoryMongo();
  try {
    const createdResponse = await createDaily(request('http://localhost/api/daily', 'POST', {
      date: '2026-10-08', onlineSales: 100, cashSales: 50, expenses: { Food: 20, Salary: 10 },
      expensePaidOnline: 15, expensePaidCash: 5, notes: 'Initial'
    }));
    assert.equal(createdResponse.status, 200);
    const created = await createdResponse.json() as { id: string };
    assert.ok(created.id);
    assert.equal((await (await listDaily(authenticatedRequest('http://localhost/api/daily'))).json())[0].onlineSales, 100);

    assert.equal((await updateDaily(request('http://localhost/api/daily', 'PATCH', {
      date: '2026-10-09', onlineSales: 200, cashSales: 75, expenses: { Food: 30, Salary: 15 },
      expensePaidOnline: 20, expensePaidCash: 10, notes: 'Edited'
    }), context(created.id))).status, 200);
    const updated = (await (await listDaily(authenticatedRequest('http://localhost/api/daily'))).json())[0];
    assert.equal(updated.date, '2026-10-09');
    assert.deepEqual(updated.expenses, { Food: 30, Salary: 15 });

    assert.equal((await deleteDaily(request('http://localhost/api/daily', 'DELETE'), context(created.id))).status, 200);
    assert.deepEqual(await (await listDaily(authenticatedRequest('http://localhost/api/daily'))).json(), []);
  } finally {
    mongo.restore();
  }
});

test('purchases retain owner add, edit, list, and delete behavior', async () => {
  const mongo = installInMemoryMongo();
  try {
    const createdResponse = await createPurchase(request('http://localhost/api/purchases', 'POST', {
      purchaseDate: '2026-10-01', paymentDate: '2026-10-02', vendorAmounts: { VendorA: 100 },
      onlinePurchasePaid: 60, cashPurchasePaid: 20
    }));
    assert.equal(createdResponse.status, 200);
    const created = await createdResponse.json() as { id: string };
    assert.ok(created.id);

    assert.equal((await updatePurchase(request('http://localhost/api/purchases', 'PATCH', {
      purchaseDate: '2026-10-03', paymentDate: '2026-10-04', vendorAmounts: { VendorA: 125, VendorB: 25 },
      onlinePurchasePaid: 75, cashPurchasePaid: 25
    }), context(created.id))).status, 200);
    const updated = (await (await listPurchases(authenticatedRequest('http://localhost/api/purchases'))).json())[0];
    assert.equal(updated.purchaseDate, '2026-10-03');
    assert.equal(updated.vendorAmounts.VendorA, 125);

    assert.equal((await deletePurchase(request('http://localhost/api/purchases', 'DELETE'), context(created.id))).status, 200);
    assert.deepEqual(await (await listPurchases(authenticatedRequest('http://localhost/api/purchases'))).json(), []);
  } finally {
    mongo.restore();
  }
});
