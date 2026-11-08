import * as XLSX from 'xlsx';
import type { DailyEntry, PurchaseEntry, BusinessSettings } from '@/types/domain';
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_VENDORS } from '@/lib/constants';

function toNumber(v: unknown, context = 'Amount') {
  if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${context} must be a valid number.`);
  return n;
}
function toISODate(v: unknown, context = 'Date'): string | null {
  if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) return null;
  if (v instanceof Date) {
    if (!Number.isFinite(v.getTime())) throw new Error(`${context} must be a valid date.`);
    return `${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')}`;
  }
  if (typeof v === 'number') {
    const parsed = XLSX.SSF.parse_date_code(v);
    if (!parsed) throw new Error(`${context} must be a valid date.`);
    return `${parsed.y}-${String(parsed.m).padStart(2,'0')}-${String(parsed.d).padStart(2,'0')}`;
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const parsed = new Date(`${s}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== s) {
      throw new Error(`${context} must be a valid date.`);
    }
    return s;
  }
  const parsed = new Date(s);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${context} must be a valid date.`);
  return parsed.toISOString().slice(0, 10);
}

export function parseConicWorkbook(buffer: Buffer, businessId: string) {
  const book = XLSX.read(buffer, { cellDates: true });
  const settingsSheet = book.Sheets['Settings'];
  const dailySheet = book.Sheets['Daily Sales & Expenses'];
  const purchasesSheet = book.Sheets['Weekly Purchases'];
  if (!dailySheet || !purchasesSheet || !settingsSheet) throw new Error('Workbook must contain Settings, Daily Sales & Expenses, and Weekly Purchases sheets.');

  const settingsRows = XLSX.utils.sheet_to_json<any[]>(settingsSheet, { header: 1, defval: null });
  let openingOnlineBalance = 0, openingCashBalance = 0;
  for (const row of settingsRows) {
    if (row?.[0] === 'Opening Online Balance') openingOnlineBalance = toNumber(row[1], 'Opening Online Balance');
    if (row?.[0] === 'Opening Cash Balance') openingCashBalance = toNumber(row[1], 'Opening Cash Balance');
  }
  const vendors = settingsRows.slice(6).map(r => r?.[0]).filter(Boolean).map(String);
  const expenseCategories = settingsRows.slice(6).map(r => r?.[2]).filter(Boolean).map(String);
  const finalVendors = vendors.length ? vendors : DEFAULT_VENDORS;
  const finalExpenses = expenseCategories.length ? expenseCategories : DEFAULT_EXPENSE_CATEGORIES;

  const dailySheetRows = XLSX.utils.sheet_to_json<any[]>(dailySheet, { header: 1, defval: null });
  const dailyHeader = dailySheetRows[0] || [];
  const dailyRows = dailySheetRows.slice(1);
  const dailyColumn = (name:string,fallback:number) => { const index=dailyHeader.findIndex((value:unknown)=>String(value||'').trim()===name); return index>=0?index:fallback; };
  const reservedDailyColumns = new Set([
    'Date', 'Online Sales', 'Cash Sales', 'Expense Paid Online', 'Expense Paid Cash', 'Notes'
  ]);
  const dailyExpenseCategories=[...new Set([
    ...finalExpenses,
    ...dailyHeader.slice(3,8),
    ...dailyHeader.slice(16)
  ].map(value=>String(value||'').trim()).filter(value=>value && !reservedDailyColumns.has(value)))];
  const dailyEntries: DailyEntry[] = [];
  for (const [index, row] of dailyRows.entries()) {
    const rowNumber = index + 2;
    const date = toISODate(row?.[dailyColumn('Date',0)], `Daily Sales & Expenses row ${rowNumber} date`); if (!date) continue;
    const expenses: Record<string, number> = {};
    dailyExpenseCategories.forEach((name, i) => expenses[name] = toNumber(row?.[dailyColumn(name,4+i)], `${name} on Daily Sales & Expenses row ${rowNumber}`));
    const onlineSales=toNumber(row?.[dailyColumn('Online Sales',1)], `Online Sales on Daily Sales & Expenses row ${rowNumber}`),cashSales=toNumber(row?.[dailyColumn('Cash Sales',2)], `Cash Sales on Daily Sales & Expenses row ${rowNumber}`);
    const expensePaidOnline=toNumber(row?.[dailyColumn('Expense Paid Online',9)], `Expense Paid Online on Daily Sales & Expenses row ${rowNumber}`),expensePaidCash=toNumber(row?.[dailyColumn('Expense Paid Cash',10)], `Expense Paid Cash on Daily Sales & Expenses row ${rowNumber}`);
    const notes=String(row?.[dailyColumn('Notes',15)]||'');
    if (onlineSales || cashSales || Object.values(expenses).some(Boolean) || expensePaidOnline || expensePaidCash || notes) {
      dailyEntries.push({ businessId, date, onlineSales, cashSales, expenses, expensePaidOnline, expensePaidCash, notes });
    }
  }

  const pRows = XLSX.utils.sheet_to_json<any[]>(purchasesSheet, { header: 1, defval: null }).slice(1);
  const header = XLSX.utils.sheet_to_json<any[]>(purchasesSheet, { header: 1, defval: null })[0] || [];
  const reservedPurchaseColumns = new Set(['Purchase Date','Payment Date','Total Weekly Purchase','Online Purchase Paid','Cash Purchase Paid','Pending Purchase']);
  const sheetPurchaseCategories = header.map((value,index)=>({name:String(value||'').trim(),index})).filter(item=>item.index>=2&&item.name&&!reservedPurchaseColumns.has(item.name));
  const purchaseCategories = sheetPurchaseCategories.length ? sheetPurchaseCategories : finalVendors.map((name,index)=>({name,index:index+2}));
  const purchaseColumn=(name:string,fallback:number) => {const index=header.findIndex((value:unknown)=>String(value||'').trim()===name);return index>=0?index:fallback;};
  const purchaseEntries: PurchaseEntry[] = [];
  for (const [index, row] of pRows.entries()) {
    const rowNumber = index + 2;
    const purchaseDate = toISODate(row?.[purchaseColumn('Purchase Date',0)], `Weekly Purchases row ${rowNumber} purchase date`); if (!purchaseDate) continue;
    const vendorAmounts: Record<string, number> = {};
    purchaseCategories.forEach(({name,index: column}) => vendorAmounts[name] = toNumber(row?.[column], `${name} on Weekly Purchases row ${rowNumber}`));
    const onlinePurchasePaid = toNumber(row?.[purchaseColumn('Online Purchase Paid',13)], `Online Purchase Paid on Weekly Purchases row ${rowNumber}`); const cashPurchasePaid = toNumber(row?.[purchaseColumn('Cash Purchase Paid',14)], `Cash Purchase Paid on Weekly Purchases row ${rowNumber}`);
    if (Object.values(vendorAmounts).some(Boolean) || onlinePurchasePaid || cashPurchasePaid) {
      purchaseEntries.push({ businessId, purchaseDate, paymentDate: toISODate(row?.[purchaseColumn('Payment Date',1)], `Weekly Purchases row ${rowNumber} payment date`), vendorAmounts, onlinePurchasePaid, cashPurchasePaid });
    }
  }

  const settings: BusinessSettings = { name: 'CONIC', currency: 'INR', dateFormat: 'DD-MMM-YYYY', openingOnlineBalance, openingCashBalance, vendors: finalVendors, expenseCategories: finalExpenses };
  return { settings, dailyEntries, purchaseEntries };
}
