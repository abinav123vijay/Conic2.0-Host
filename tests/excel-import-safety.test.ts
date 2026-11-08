import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { POST as importWorkbook } from '../app/api/excel/import/route';
import { BUSINESS_ID } from '../lib/constants';
import { authenticatedRequest } from './helpers/auth-request';
import { installInMemoryMongo } from './helpers/in-memory-mongodb';

function invalidWorkbook() {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Opening Online Balance', 1]]), 'Settings');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Date', 'Online Sales', 'Cash Sales', 'Food'],
    ['2026-02-30', 10, 0, 0]
  ]), 'Daily Sales & Expenses');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Purchase Date', 'Payment Date', 'VendorA']
  ]), 'Weekly Purchases');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

test('invalid Excel import reports an error and leaves all existing collections unchanged', async () => {
  const mongo = installInMemoryMongo();
  const seed = {
    businesses: [{ _id: BUSINESS_ID, openingOnlineBalance: 2000 }],
    dailyEntries: [{ businessId: BUSINESS_ID, date: '2026-10-01', onlineSales: 100 }],
    purchaseEntries: [{ businessId: BUSINESS_ID, purchaseDate: '2026-10-02', vendorAmounts: { VendorA: 50 } }],
    monthlyFinance: [{ businessId: BUSINESS_ID, period: '2026-10', savingsDeposit: 10 }],
    financeLoans: [{ businessId: BUSINESS_ID, amountTaken: 100 }],
    vendorDefectReturns: [{ businessId: BUSINESS_ID, amount: 20 }]
  };
  for (const [collection, documents] of Object.entries(seed)) {
    mongo.documents(collection).push(...documents);
  }
  const before = Object.fromEntries(Object.keys(seed).map(collection => [
    collection,
    JSON.stringify(mongo.documents(collection))
  ]));

  try {
    const form = new FormData();
    const workbookBytes = Uint8Array.from(invalidWorkbook());
    form.set('file', new File([workbookBytes.buffer], 'invalid.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }));
    const response = await importWorkbook(authenticatedRequest('http://localhost/api/excel/import', {
      method: 'POST',
      body: form
    }));
    assert.equal(response.status, 400);
    assert.match(((await response.json()) as { error: string }).error, /valid date/i);
    for (const collection of Object.keys(seed)) {
      assert.equal(JSON.stringify(mongo.documents(collection)), before[collection], `${collection} changed on invalid import`);
    }
  } finally {
    mongo.restore();
  }
});
