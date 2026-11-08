import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateBalancesThrough } from '../lib/finance/balances';
import { isValidBalanceDate } from '../lib/dashboard/balance-as-of';
import type { DailyEntry, FinanceLoan, FinanceMonth, PurchaseEntry, VendorDefectReturn } from '../types/domain';

const daily: DailyEntry[] = [{
  businessId: 'test',
  date: '2026-10-01',
  onlineSales: 300,
  cashSales: 70,
  expenses: { Food: 125 },
  expensePaidOnline: 100,
  expensePaidCash: 25,
  notes: ''
}];

const purchases: PurchaseEntry[] = [{
  businessId: 'test',
  purchaseDate: '2026-10-02',
  paymentDate: '2026-10-05',
  vendorAmounts: { VendorA: 250 },
  onlinePurchasePaid: 200,
  cashPurchasePaid: 50
}];

const finance: FinanceMonth[] = [{
  businessId: 'test',
  period: '2026-10',
  year: 2026,
  month: 10,
  salaries: [{ person: 'Employee', amount: 300, paymentDate: '2026-10-04' }],
  truckEmi: 100,
  truckEmiPaymentDate: '2026-10-06',
  autoEmi: 50,
  autoEmiPaymentDate: '2026-10-06',
  roomRent: 90,
  roomRentPaymentDate: '2026-10-31',
  savingsDeposit: 75,
  partnerPayments: []
}];

const loans: FinanceLoan[] = [{
  businessId: 'test',
  person: 'Lender',
  source: 'friend',
  amountTaken: 1000,
  takenDate: '2026-10-01',
  repayments: [{ date: '2026-10-07', amount: 40 }],
  notes: ''
}];

const vendorReturns: VendorDefectReturn[] = [{
  businessId: 'test',
  vendor: 'VendorA',
  returnDate: '2026-10-02',
  amount: 80,
  receipts: [{ date: '2026-10-06', amount: 35 }],
  notes: ''
}];

test('balance ledger applies sales, paid expenses and dated purchase payments to the correct accounts', () => {
  const beforePayment = calculateBalancesThrough(
    '2026-10-03', daily, purchases, { online: 1000, cash: 500 }, finance, vendorReturns, loans
  );
  assert.deepEqual(beforePayment, { online: 1200, cash: 545, total: 1745 });

  const afterPayment = calculateBalancesThrough(
    '2026-10-05', daily, purchases, { online: 1000, cash: 500 }, finance, vendorReturns, loans
  );
  assert.deepEqual(afterPayment, { online: 700, cash: 495, total: 1195 });
});

test('salary, EMI, rent, savings and loan repayment reduce online balance only on their effective dates', () => {
  const beforeOutflows = calculateBalancesThrough(
    '2026-10-03', daily, [], { online: 1000, cash: 500 }, finance, [], loans
  );
  assert.deepEqual(beforeOutflows, { online: 1200, cash: 545, total: 1745 });

  const afterDatedOutflows = calculateBalancesThrough(
    '2026-10-07', daily, [], { online: 1000, cash: 500 }, finance, [], loans
  );
  assert.deepEqual(afterDatedOutflows, { online: 710, cash: 545, total: 1255 });

  const monthEnd = calculateBalancesThrough(
    '2026-10-31', daily, [], { online: 1000, cash: 500 }, finance, [], loans
  );
  assert.deepEqual(monthEnd, { online: 545, cash: 545, total: 1090 });
});

test('salary payments reduce online and cash balances by their recorded split', () => {
  const splitSalary: FinanceMonth[] = [{
    businessId: 'test',
    period: '2026-10',
    year: 2026,
    month: 10,
    salaries: [{ person: 'Employee', amount: 15000, paidOnline: 14200, paidCash: 800, paymentDate: '2026-10-04' }],
    truckEmi: 0,
    autoEmi: 0,
    roomRent: 0,
    savingsDeposit: 0,
    partnerPayments: []
  }];
  assert.deepEqual(
    calculateBalancesThrough('2026-10-04', [], [], { online: 20000, cash: 1000 }, splitSalary),
    { online: 5800, cash: 200, total: 6000 }
  );
  assert.deepEqual(
    calculateBalancesThrough('2026-10-03', [], [], { online: 20000, cash: 1000 }, splitSalary),
    { online: 20000, cash: 1000, total: 21000 }
  );
});

test('auto EMI balance impact uses only the business share and rent uses its payment date', () => {
  const datedFinance: FinanceMonth[] = [{
    businessId: 'test',
    period: '2026-10',
    year: 2026,
    month: 10,
    salaries: [],
    truckEmi: 21275,
    truckEmiPaymentDate: '2026-10-10',
    autoEmi: 8597,
    autoEmiFriendShare: 4298,
    autoEmiPaymentDate: '2026-10-10',
    roomRent: 200,
    roomRentPaymentDate: '2026-10-15',
    savingsDeposit: 0,
    partnerPayments: []
  }];
  assert.deepEqual(
    calculateBalancesThrough('2026-10-09', [], [], { online: 50000, cash: 0 }, datedFinance),
    { online: 50000, cash: 0, total: 50000 }
  );
  assert.deepEqual(
    calculateBalancesThrough('2026-10-10', [], [], { online: 50000, cash: 0 }, datedFinance),
    { online: 24426, cash: 0, total: 24426 }
  );
  assert.deepEqual(
    calculateBalancesThrough('2026-10-15', [], [], { online: 50000, cash: 0 }, datedFinance),
    { online: 24226, cash: 0, total: 24226 }
  );
  assert.equal(21275 + 8597 - 4298, 25574);
});

test('rent without a saved payment date is deducted on the first of its month', () => {
  const rentWithoutDate: FinanceMonth[] = [{
    businessId: 'test',
    period: '2026-10',
    year: 2026,
    month: 10,
    salaries: [],
    truckEmi: 0,
    autoEmi: 0,
    roomRent: 200,
    savingsDeposit: 0,
    partnerPayments: []
  }];
  assert.equal(calculateBalancesThrough('2026-09-30', [], [], { online: 1000, cash: 0 }, rentWithoutDate).online, 1000);
  assert.equal(calculateBalancesThrough('2026-10-01', [], [], { online: 1000, cash: 0 }, rentWithoutDate).online, 800);
});

test('borrowed principal does not increase available balance and vendor refunds increase total only when received', () => {
  const beforeReceipt = calculateBalancesThrough(
    '2026-10-05', daily, [], { online: 1000, cash: 500 }, [], vendorReturns, loans
  );
  const afterReceipt = calculateBalancesThrough(
    '2026-10-06', daily, [], { online: 1000, cash: 500 }, [], vendorReturns, loans
  );
  assert.deepEqual(beforeReceipt, { online: 1200, cash: 545, total: 1745 });
  assert.deepEqual(afterReceipt, { online: 1200, cash: 545, total: 1780 });
});

test('balance date validation rejects impossible and malformed dates', () => {
  assert.equal(isValidBalanceDate('2026-10-08'), true);
  assert.equal(isValidBalanceDate('2026-02-29'), false);
  assert.equal(isValidBalanceDate('2026-13-01'), false);
  assert.equal(isValidBalanceDate('08-10-2026'), false);
  assert.equal(isValidBalanceDate(''), false);
});

test('as-of balances include transactions on the selected date and exclude future activity', () => {
  const datedDaily: DailyEntry[] = [
    {
      businessId: 'test',
      date: '2026-10-08',
      onlineSales: 80,
      cashSales: 40,
      expenses: {},
      expensePaidOnline: 10,
      expensePaidCash: 5,
      notes: ''
    },
    {
      businessId: 'test',
      date: '2026-10-09',
      onlineSales: 500,
      cashSales: 600,
      expenses: {},
      expensePaidOnline: 0,
      expensePaidCash: 0,
      notes: ''
    }
  ];
  const datedPurchases: PurchaseEntry[] = [
    {
      businessId: 'test',
      purchaseDate: '2026-10-08',
      paymentDate: null,
      vendorAmounts: { VendorA: 50 },
      onlinePurchasePaid: 30,
      cashPurchasePaid: 20
    },
    {
      businessId: 'test',
      purchaseDate: '2026-10-08',
      paymentDate: '2026-10-09',
      vendorAmounts: { VendorB: 90 },
      onlinePurchasePaid: 40,
      cashPurchasePaid: 50
    }
  ];

  assert.deepEqual(
    calculateBalancesThrough('2026-10-08', datedDaily, datedPurchases, { online: 100, cash: 50 }),
    { online: 140, cash: 65, total: 205 }
  );
  assert.deepEqual(
    calculateBalancesThrough('2026-10-09', datedDaily, datedPurchases, { online: 100, cash: 50 }),
    { online: 600, cash: 615, total: 1215 }
  );
});
