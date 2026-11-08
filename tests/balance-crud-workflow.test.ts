import assert from 'node:assert/strict';
import test from 'node:test';
import { GET as yearlyDashboard } from '../app/api/dashboard/yearly/route';
import { getBalanceAsOf } from '../lib/dashboard/balance-as-of';
import { getMonthlyDashboard, getViewerMonthlyDashboard } from '../lib/dashboard/metrics';
import { BUSINESS_ID } from '../lib/constants';
import { authenticatedRequest } from './helpers/auth-request';
import { installInMemoryMongo } from './helpers/in-memory-mongodb';

test('monthly operating results count daily expenses once and only recorded rent', async () => {
  const mongo = installInMemoryMongo();
  mongo.documents('businesses').push({
    _id: BUSINESS_ID,
    openingOnlineBalance: 10000,
    openingCashBalance: 5000,
    vendors: ['Vendor A'],
    expenseCategories: ['Fuel']
  });
  mongo.documents('dailyEntries').push({
    businessId: BUSINESS_ID, date: '2026-10-10', onlineSales: 1000, cashSales: 500,
    expenses: { Salary: 100, Fuel: 200 }, expensePaidOnline: 100, expensePaidCash: 150
  });
  mongo.documents('purchaseEntries').push({
    businessId: BUSINESS_ID, purchaseDate: '2026-10-10', paymentDate: '2026-10-10',
    vendorAmounts: { 'Vendor A': 300 }, onlinePurchasePaid: 200, cashPurchasePaid: 0
  });
  mongo.documents('monthlyFinance').push({
    businessId: BUSINESS_ID, period: '2026-10', salaries: [{ person: 'Legacy Salary', amount: 9000 }],
    truckEmi: 5000, autoEmi: 6000, savingsDeposit: 700
  });
  mongo.documents('partnerDistributions').push({
    businessId: BUSINESS_ID, period: '2026-10', approvedAmount: 1200,
    friendAllocation: 480, investorAllocation: 720, payments: []
  });

  try {
    let dashboard = await getMonthlyDashboard(2026, 10);
    assert.equal(dashboard.rent, 0);
    assert.equal(dashboard.dailySalary, 100);
    assert.equal(dashboard.dailyOperatingExpenses, 200);
    assert.equal(dashboard.totalExpenses, 300);
    assert.equal(dashboard.totalSales, 1500);
    assert.equal(dashboard.totalPurchases, 300);
    assert.equal(dashboard.netAmount, 900);
    assert.equal(dashboard.approvedDistribution, 1200);
    assert.equal(dashboard.expenseBreakdown.reduce((total, item) => total + item.amount, 0), 300);

    mongo.documents('rentPayments').push({
      businessId: BUSINESS_ID, period: '2026-10', amount: 50, paymentDate: '2026-10-10', status: 'paid'
    });
    dashboard = await getMonthlyDashboard(2026, 10);
    assert.equal(dashboard.totalExpenses, 350);
    assert.equal(dashboard.netAmount, 850);
    assert.equal(dashboard.expenseBreakdown.find(item => item.name === 'Rent')?.amount, 50);
  } finally {
    mongo.restore();
  }
});

test('as-of balances use daily operations and purchases, not legacy finance or loan records', async () => {
  const mongo = installInMemoryMongo();
  mongo.documents('businesses').push({
    _id: BUSINESS_ID, openingOnlineBalance: 10000, openingCashBalance: 5000
  });
  mongo.documents('dailyEntries').push({
    businessId: BUSINESS_ID, date: '2026-10-10', onlineSales: 1000, cashSales: 500,
    expenses: { Salary: 250 }, expensePaidOnline: 100, expensePaidCash: 150
  });
  mongo.documents('purchaseEntries').push({
    businessId: BUSINESS_ID, purchaseDate: '2026-10-10', paymentDate: '2026-10-10',
    vendorAmounts: { 'Vendor A': 300 }, onlinePurchasePaid: 200, cashPurchasePaid: 0
  });
  mongo.documents('monthlyFinance').push({
    businessId: BUSINESS_ID, period: '2026-10', truckEmi: 10000, autoEmi: 20000, savingsDeposit: 500
  });
  mongo.documents('financeLoans').push({
    businessId: BUSINESS_ID, amountTaken: 100000, repayments: [{ date: '2026-10-10', amount: 5000 }]
  });

  try {
    assert.deepEqual(await getBalanceAsOf('2026-10-10'), {
      online: 10700, cash: 5350, total: 16050
    });
  } finally {
    mongo.restore();
  }
});

test('viewer monthly dashboard limits purchases to configured approved vendors and returns a safe summary', async () => {
  const mongo = installInMemoryMongo();
  mongo.documents('businesses').push({
    _id: BUSINESS_ID, vendors: ['Approved Vendor', 'Other', 'Transport'],
    expenseCategories: ['Hidden Category'], openingOnlineBalance: 50000, openingCashBalance: 2000
  });
  mongo.documents('dailyEntries').push({
    businessId: BUSINESS_ID, date: '2026-10-10', onlineSales: 1000, cashSales: 500,
    expenses: { Salary: 900, 'Hidden Category': 300 }, expensePaidOnline: 900, expensePaidCash: 300
  });
  mongo.documents('purchaseEntries').push({
    businessId: BUSINESS_ID, purchaseDate: '2026-10-10', paymentDate: '2026-10-10',
    vendorAmounts: { 'Approved Vendor': 200, Other: 300, Transport: 400 },
    onlinePurchasePaid: 200, cashPurchasePaid: 100
  });
  mongo.documents('rentPayments').push({
    businessId: BUSINESS_ID, period: '2026-10', amount: 10000, paymentDate: '2026-10-10', status: 'paid'
  });

  try {
    const summary = await getViewerMonthlyDashboard(2026, 10);
    assert.equal(summary.totalSales, 1500);
    assert.equal(summary.totalPurchases, 200);
    assert.equal(summary.salesAfterPurchases, 1300);
    assert.deepEqual(summary.vendorPurchases, [{ name: 'Approved Vendor', amount: 200 }]);
    assert.deepEqual(Object.keys(summary).sort(), [
      'cashSales', 'daily', 'month', 'onlineSales', 'salesAfterPurchases', 'totalPurchases', 'totalSales', 'vendorPurchases', 'year'
    ]);
    assert.doesNotMatch(JSON.stringify(summary), /salary|expense|rent|balance|reconciliation/i);
  } finally {
    mongo.restore();
  }
});

test('yearly dashboard totals reconcile across months and viewer response omits owner-only figures', async () => {
  const mongo = installInMemoryMongo();
  mongo.documents('businesses').push({
    _id: BUSINESS_ID,
    openingOnlineBalance: 5000,
    openingCashBalance: 1000,
    vendors: ['Approved Vendor', 'Other'],
    expenseCategories: ['Fuel']
  });
  mongo.documents('dailyEntries').push(
    {
      businessId: BUSINESS_ID, date: '2026-01-10', onlineSales: 1000, cashSales: 200,
      expenses: { Fuel: 50, Salary: 25 }, expensePaidOnline: 50, expensePaidCash: 25
    },
    {
      businessId: BUSINESS_ID, date: '2026-12-10', onlineSales: 2000, cashSales: 300,
      expenses: { Fuel: 75 }, expensePaidOnline: 50, expensePaidCash: 25
    }
  );
  mongo.documents('purchaseEntries').push(
    {
      businessId: BUSINESS_ID, purchaseDate: '2026-01-10', paymentDate: '2026-01-10',
      vendorAmounts: { 'Approved Vendor': 200, Other: 100 }, onlinePurchasePaid: 200, cashPurchasePaid: 0
    },
    {
      businessId: BUSINESS_ID, purchaseDate: '2026-12-10', paymentDate: '2026-12-10',
      vendorAmounts: { 'Approved Vendor': 300, Other: 200 }, onlinePurchasePaid: 300, cashPurchasePaid: 0
    }
  );
  mongo.documents('rentPayments').push({
    businessId: BUSINESS_ID, period: '2026-12', amount: 100, paymentDate: '2026-12-10', status: 'paid'
  });

  try {
    const ownerResponse = await yearlyDashboard(authenticatedRequest(
      'http://localhost/api/dashboard/yearly?year=2026'
    ));
    assert.equal(ownerResponse.status, 200);
    const owner = await ownerResponse.json();
    assert.equal(owner.totalSales, 3500);
    assert.equal(owner.totalPurchases, 800);
    assert.equal(owner.totalExpenses, 250);
    assert.equal(owner.netAmount, 2450);
    assert.equal(owner.months.length, 12);
    assert.equal(owner.months[0].netAmount, 825);
    assert.equal(owner.months[11].netAmount, 1625);

    const viewerResponse = await yearlyDashboard(authenticatedRequest(
      'http://localhost/api/dashboard/yearly?year=2026',
      {},
      'viewer'
    ));
    assert.equal(viewerResponse.status, 200);
    const viewer = await viewerResponse.json();
    assert.equal(viewer.totalSales, 3500);
    assert.equal(viewer.totalPurchases, 500);
    assert.equal(viewer.salesAfterPurchases, 3000);
    assert.deepEqual(Object.keys(viewer).sort(), [
      'months', 'salesAfterPurchases', 'totalPurchases', 'totalSales', 'year'
    ]);
    assert.doesNotMatch(JSON.stringify(viewer), /salary|expenses|rent|balance|reconciliation|profit/i);
  } finally {
    mongo.restore();
  }
});
