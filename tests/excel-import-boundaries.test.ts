import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { parseConicWorkbook } from '../lib/excel/parse';

function workbookBuffer(dailyRows: unknown[][], purchaseRows: unknown[][] = []) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Opening Online Balance', 100],
    ['Opening Cash Balance', 50],
    [],
    [],
    [],
    [],
    ['VendorA', null, 'Food']
  ]), 'Settings');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Date', 'Online Sales', 'Cash Sales', 'Food', 'Expense Paid Online', 'Expense Paid Cash', 'Notes'],
    ...dailyRows
  ]), 'Daily Sales & Expenses');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Purchase Date', 'Payment Date', 'VendorA', 'Total Weekly Purchase', 'Online Purchase Paid', 'Cash Purchase Paid', 'Pending Purchase'],
    ...purchaseRows
  ]), 'Weekly Purchases');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Period', 'Truck EMI', 'Auto EMI', 'Loan Amount'],
    ['not-a-period', 'invalid', 'invalid', 'invalid']
  ]), 'Legacy Finance');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

test('Excel import rejects malformed workbook data instead of silently dropping or zeroing it', () => {
  assert.throws(() => parseConicWorkbook(Buffer.from('not an Excel workbook'), 'test-business'));

  const invalidDate = workbookBuffer([['2026-02-30', 10, 0, 0, 0, 0, '']]);
  assert.throws(
    () => parseConicWorkbook(invalidDate, 'test-business'),
    /Daily Sales & Expenses row 2 date must be a valid date/
  );

  const invalidAmount = workbookBuffer([['2026-10-08', 'not-a-number', 0, 0, 0, 0, '']]);
  assert.throws(
    () => parseConicWorkbook(invalidAmount, 'test-business'),
    /Online Sales on Daily Sales & Expenses row 2 must be a valid number/
  );
});

test('Excel import preserves duplicate transactions and ignores legacy finance sheets', () => {
  const duplicate = ['2026-10-08', 10, 5, 2, 1, 1, 'same transaction'];
  const buffer = workbookBuffer([duplicate, duplicate], [
    ['2026-10-08', '2026-10-08', 20, 20, 10, 10, 0],
    ['2026-10-08', '2026-10-08', 20, 20, 10, 10, 0]
  ]);
  const parsed = parseConicWorkbook(buffer, 'test-business');

  assert.equal(parsed.dailyEntries.length, 2);
  assert.equal(parsed.purchaseEntries.length, 2);
  assert.deepEqual(Object.keys(parsed).sort(), ['dailyEntries', 'purchaseEntries', 'settings']);
});
