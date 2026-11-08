import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { GET as listDaily } from '../app/api/daily/route';
import { GET as listPurchases } from '../app/api/purchases/route';
import { GET as settings } from '../app/api/settings/route';
import { BUSINESS_ID } from '../lib/constants';
import { installInMemoryMongo } from './helpers/in-memory-mongodb';
import { authHeaders, authenticatedRequest } from './helpers/auth-request';

test('viewer daily and purchase APIs expose only approved fields', async () => {
  const mongo = installInMemoryMongo();
  mongo.documents('businesses').push({
    _id: BUSINESS_ID,
    vendors: ['Approved Vendor', 'Other', 'Transport'],
    expenseCategories: ['Fuel'],
    openingOnlineBalance: 50000,
    openingCashBalance: 2000
  });
  mongo.documents('dailyEntries').push({
    _id: 'daily-1', businessId: BUSINESS_ID, date: '2026-10-08',
    onlineSales: 1000, cashSales: 500, expenses: { Salary: 250, Fuel: 100 },
    expensePaidOnline: 250, expensePaidCash: 100, notes: 'Owner only'
  });
  mongo.documents('purchaseEntries').push({
    _id: 'purchase-1', businessId: BUSINESS_ID, purchaseDate: '2026-10-08',
    paymentDate: '2026-10-09', vendorAmounts: { 'Approved Vendor': 200, Other: 300, Transport: 400 },
    onlinePurchasePaid: 200, cashPurchasePaid: 100
  });

  try {
    const daily = await (await listDaily(authenticatedRequest('http://localhost/api/daily', {}, 'viewer'))).json();
    assert.deepEqual(daily, [{
      id: 'daily-1', date: '2026-10-08', onlineSales: 1000, cashSales: 500, totalSales: 1500
    }]);

    const purchases = await (await listPurchases(authenticatedRequest('http://localhost/api/purchases', {}, 'viewer'))).json();
    assert.deepEqual(purchases, [{
      id: 'purchase-1', purchaseDate: '2026-10-08',
      vendorAmounts: { 'Approved Vendor': 200 }, totalPurchases: 200
    }]);
  } finally {
    mongo.restore();
  }
});

test('owner-only settings API rejects viewers', async () => {
  assert.equal((await settings(new NextRequest(
    'http://localhost/api/settings',
    { headers: authHeaders('viewer') }
  ))).status, 403);
});
