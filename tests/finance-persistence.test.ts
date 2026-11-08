import assert from 'node:assert/strict';
import test from 'node:test';
import { ObjectId } from 'mongodb';
import { GET as getSavings, PUT as saveSavings } from '../app/api/finance/savings/route';
import { GET as getRent, PUT as saveRent } from '../app/api/finance/rent/route';
import {
  GET as getDistributions,
  POST as recordPartnerPayment,
  PUT as approveDistribution
} from '../app/api/finance/partner-payments/route';
import { PATCH as updateDaily } from '../app/api/daily/[id]/route';
import { BUSINESS_ID } from '../lib/constants';
import { getBalanceAsOf } from '../lib/dashboard/balance-as-of';
import { authenticatedRequest } from './helpers/auth-request';
import { installInMemoryMongo } from './helpers/in-memory-mongodb';

const jsonRequest = (url: string, method: string, body: unknown) =>
  authenticatedRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

test('rent is optional until recorded and owners can persist monthly rent', async () => {
  const mongo = installInMemoryMongo();
  try {
    assert.deepEqual(await (await getRent(authenticatedRequest('http://localhost/api/finance/rent'))).json(), []);
    assert.equal((await saveRent(jsonRequest('http://localhost/api/finance/rent', 'PUT', {
      period: '2026-10', amount: 2500, paymentDate: '2026-10-08', status: 'paid', notes: 'October rent'
    }))).status, 200);

    const records = await (await getRent(authenticatedRequest('http://localhost/api/finance/rent'))).json();
    assert.deepEqual(records, [{
      businessId: BUSINESS_ID,
      period: '2026-10',
      amount: 2500,
      paymentDate: '2026-10-08',
      status: 'paid',
      notes: 'October rent',
      updatedAt: records[0].updatedAt,
      createdAt: records[0].createdAt
    }]);
  } finally {
    mongo.restore();
  }
});

test('partner approvals allocate 40/60, enforce configured investor shares, and reject duplicate or excess payments', async () => {
  const mongo = installInMemoryMongo();
  try {
    const approval = await approveDistribution(jsonRequest('http://localhost/api/finance/partner-payments', 'PUT', {
      period: '2026-10', approvedAmount: 1000, investor1Percent: 25, investor2Percent: 75, notes: 'Approved'
    }));
    assert.equal(approval.status, 200);
    assert.deepEqual(await approval.json(), {
      ok: true, friendAllocation: 400, investorAllocation: 600
    });

    const records = await (await getDistributions(authenticatedRequest('http://localhost/api/finance/partner-payments'))).json();
    assert.equal(records[0].status, 'pending');
    assert.equal(records[0].investor1Percent, 25);

    const payment = {
      period: '2026-10', recipient: 'investor1', amount: 100, paymentDate: '2026-10-12', note: 'First transfer'
    };
    assert.equal((await recordPartnerPayment(jsonRequest('http://localhost/api/finance/partner-payments', 'POST', payment))).status, 201);
    assert.equal((await recordPartnerPayment(jsonRequest('http://localhost/api/finance/partner-payments', 'POST', payment))).status, 409);
    assert.equal((await recordPartnerPayment(jsonRequest('http://localhost/api/finance/partner-payments', 'POST', {
      ...payment, amount: 51, paymentDate: '2026-10-13'
    }))).status, 400);
    assert.equal((await recordPartnerPayment(jsonRequest('http://localhost/api/finance/partner-payments', 'POST', {
      ...payment, recipient: 'friend', amount: 401
    }))).status, 400);

    const stored = mongo.documents('partnerDistributions')[0];
    assert.equal(stored._id, `${BUSINESS_ID}:2026-10`);
    assert.deepEqual(stored.payments, [{
      recipient: 'investor1', amount: 100, paymentDate: '2026-10-12', note: 'First transfer'
    }]);
  } finally {
    mongo.restore();
  }
});

test('daily savings are owner-only, limited to recorded sales, and deducted from the matching balances', async () => {
  const mongo = installInMemoryMongo();
  const dailyId = new ObjectId();
  mongo.documents('businesses').push({
    _id: BUSINESS_ID, openingOnlineBalance: 1000, openingCashBalance: 500
  });
  mongo.documents('dailyEntries').push({
    _id: dailyId, businessId: BUSINESS_ID, date: '2026-10-10', onlineSales: 500, cashSales: 200,
    expenses: {}, expensePaidOnline: 0, expensePaidCash: 0
  });
  try {
    assert.equal((await getSavings(authenticatedRequest('http://localhost/api/finance/savings', {}, 'viewer'))).status, 403);
    assert.deepEqual(await (await getSavings(authenticatedRequest('http://localhost/api/finance/savings'))).json(), {
      records: [],
      dailySales: [{ date: '2026-10-10', onlineSales: 500, cashSales: 200 }]
    });

    assert.equal((await saveSavings(jsonRequest('http://localhost/api/finance/savings', 'PUT', {
      date: '2026-10-10', onlineAmount: 501, cashAmount: 0, notes: ''
    }))).status, 400);
    assert.equal((await saveSavings(jsonRequest('http://localhost/api/finance/savings', 'PUT', {
      date: '2026-10-10', onlineAmount: 125, cashAmount: 50, notes: 'Daily set-aside'
    }))).status, 200);

    const balances = await getBalanceAsOf('2026-10-10');
    assert.deepEqual(balances, { online: 1375, cash: 650, total: 2025 });

    const reducedSales = await updateDaily(jsonRequest('http://localhost/api/daily/entry', 'PATCH', {
      date: '2026-10-10', onlineSales: 100, cashSales: 200,
      expenses: {}, expensePaidOnline: 0, expensePaidCash: 0, notes: ''
    }), { params: Promise.resolve({ id: dailyId.toString() }) });
    assert.equal(reducedSales.status, 409);

    assert.equal((await saveSavings(jsonRequest('http://localhost/api/finance/savings', 'PUT', {
      date: '2026-10-10', onlineAmount: 0, cashAmount: 0, notes: ''
    }))).status, 200);
    assert.deepEqual(await getBalanceAsOf('2026-10-10'), { online: 1500, cash: 700, total: 2200 });
  } finally {
    mongo.restore();
  }
});
