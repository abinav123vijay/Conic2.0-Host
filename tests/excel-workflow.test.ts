import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { GET as exportExcel } from '../app/api/excel/export/route';
import { BUSINESS_ID } from '../lib/constants';
import { authenticatedRequest } from './helpers/auth-request';
import { installInMemoryMongo } from './helpers/in-memory-mongodb';

test('owner Excel export contains Truck 2 operations, rent, partner payments, and no legacy loan or EMI data', async () => {
  const mongo = installInMemoryMongo();
  mongo.documents('businesses').push({
    _id: BUSINESS_ID, name: 'CONIC Truck 2', openingOnlineBalance: 80000, openingCashBalance: 20000,
    vendors: ['Vendor A'], expenseCategories: ['Fuel']
  });
  mongo.documents('dailyEntries').push({
    businessId: BUSINESS_ID, date: '2026-10-08', onlineSales: 5000, cashSales: 1000,
    expenses: { Fuel: 500, Salary: 250 }, expensePaidOnline: 500, expensePaidCash: 250
  });
  mongo.documents('purchaseEntries').push({
    businessId: BUSINESS_ID, purchaseDate: '2026-10-09', paymentDate: '2026-10-09',
    vendorAmounts: { 'Vendor A': 2000 }, onlinePurchasePaid: 1000, cashPurchasePaid: 500
  });
  mongo.documents('rentPayments').push({
    businessId: BUSINESS_ID, period: '2026-10', amount: 3000, paymentDate: '2026-10-10',
    status: 'paid', notes: 'October rent'
  });
  mongo.documents('partnerDistributions').push({
    businessId: BUSINESS_ID, period: '2026-10', approvedAmount: 1000, friendAllocation: 400,
    investorAllocation: 600, investor1Percent: 50, investor2Percent: 50,
    payments: [{ recipient: 'friend', amount: 200, paymentDate: '2026-10-11' }], notes: 'Approved'
  });

  try {
    const response = await exportExcel(authenticatedRequest('http://localhost/api/excel/export'));
    assert.equal(response.status, 200);
    const workbook = XLSX.read(Buffer.from(await response.arrayBuffer()), { type: 'buffer' });
    assert.deepEqual(workbook.SheetNames, [
      'Settings', 'Daily Sales & Expenses', 'Weekly Purchases', 'Rent', 'Partner Payments', 'Reconciliation'
    ]);
    assert.equal(workbook.Sheets.Settings.B1?.v, 'CONIC Truck 2');
    assert.equal(workbook.Sheets.Settings.B2?.v, BUSINESS_ID);
    assert.equal(workbook.Sheets.Rent.A2?.v, '2026-10');
    assert.equal(workbook.Sheets.Rent.B2?.v, 3000);
    assert.equal(workbook.Sheets['Partner Payments'].G2?.v, 'friend');
    assert.equal(workbook.Sheets['Partner Payments'].H2?.v, 200);
    assert.doesNotMatch(workbook.SheetNames.join(' '), /loan|emi|savings/i);
    assert.doesNotMatch(JSON.stringify(workbook.Sheets), /Truck EMI|Auto EMI|Loan Repayment/i);
  } finally {
    mongo.restore();
  }
});
