import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { GET as getReconciliationSummary } from '../app/api/reconciliation/summary/route';
import { BUSINESS_ID } from '../lib/constants';
import { authHeaders } from './helpers/auth-request';

type Record = {
  businessId: string;
  date: string;
  bookOnline: number;
  bookCash: number;
  actualOnline: number;
  actualCash: number;
  varianceOnline: number;
  varianceCash: number;
  updatedAt: Date;
};

function installReconciliationDatabase(records: Record[]) {
  const collection = {
    findOne: async (filter: { date: string }) =>
      records.find(record => record.businessId === BUSINESS_ID && record.date === filter.date) ?? null,
    find(filter: { businessId: string; $expr?: { $or: Array<{ $ne: [string, string] }> } }) {
      const filtered = records.filter(record => {
        if (record.businessId !== filter.businessId) return false;
        if (!filter.$expr) return true;
        return record.actualOnline !== record.bookOnline || record.actualCash !== record.bookCash;
      }).sort((left, right) => right.date.localeCompare(left.date));
      let limit = filtered.length;
      const cursor = {
        sort() { return cursor; },
        limit(value: number) { limit = value; return cursor; },
        async next() { return filtered[0] ?? null; },
        async toArray() { return filtered.slice(0, limit); }
      };
      return cursor;
    },
    async countDocuments(filter: { businessId: string; $expr: { $or: Array<{ $ne: [string, string] }> } }) {
      return records.filter(record => record.businessId === filter.businessId &&
        (record.actualOnline !== record.bookOnline || record.actualCash !== record.bookCash)).length;
    }
  };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, '__conicMongoDb');
  Object.defineProperty(globalThis, '__conicMongoDb', {
    configurable: true,
    writable: true,
    value: { collection: () => collection }
  });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, '__conicMongoDb', descriptor);
    else Reflect.deleteProperty(globalThis, '__conicMongoDb');
  };
}

test('reconciliation summary distinguishes matching balances and online-only or cash-only conflicts', async () => {
  const records: Record[] = [
    {
      businessId: BUSINESS_ID, date: '2026-10-05',
      bookOnline: 1000, bookCash: 500, actualOnline: 1000, actualCash: 500,
      varianceOnline: 0, varianceCash: 0, updatedAt: new Date('2026-10-05T12:00:00Z')
    },
    {
      businessId: BUSINESS_ID, date: '2026-10-06',
      bookOnline: 1000, bookCash: 500, actualOnline: 1000.01, actualCash: 500,
      varianceOnline: 0, varianceCash: 0, updatedAt: new Date('2026-10-06T12:00:00Z')
    },
    {
      businessId: BUSINESS_ID, date: '2026-10-07',
      bookOnline: 1000, bookCash: 500, actualOnline: 1000, actualCash: 499,
      varianceOnline: 0, varianceCash: 0, updatedAt: new Date('2026-10-07T12:00:00Z')
    }
  ];
  const restoreDatabase = installReconciliationDatabase(records);

  try {
    const response = await getReconciliationSummary(
      new NextRequest('http://localhost/api/reconciliation/summary?date=2026-10-08', {
        headers: authHeaders()
      })
    );
    assert.equal(response.status, 200);
    const summary = await response.json();
    assert.equal(summary.mismatchCount, 2);
    assert.deepEqual(summary.mismatches.map((item: { date: string; varianceOnline: number; varianceCash: number }) => ({
      date: item.date,
      varianceCash: item.varianceCash
    })), [
      { date: '2026-10-07', varianceCash: -1 },
      { date: '2026-10-06', varianceCash: 0 }
    ]);
    assert.ok(Math.abs(summary.mismatches[1].varianceOnline - 0.01) < 1e-9);
    assert.equal(summary.todayReconciliation, null);
    assert.equal(summary.reconciledToday, false);
  } finally {
    restoreDatabase();
  }
});
