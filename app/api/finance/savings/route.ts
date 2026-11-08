import { NextResponse } from 'next/server';
import { BUSINESS_ID } from '@/lib/constants';
import { authorize } from '@/lib/authz';
import { isValidBalanceDate } from '@/lib/dashboard/balance-as-of';
import { getDb } from '@/lib/mongodb';
import type { DailyEntry, DailySaving } from '@/types/domain';

const money = (value: number) => Math.round(value * 100) / 100;

export async function GET(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;

  const db = await getDb();
  const [records, dailyEntries] = await Promise.all([
    db.collection<DailySaving>('dailySavings').find({ businessId: BUSINESS_ID }).sort({ date: -1 }).toArray(),
    db.collection<DailyEntry>('dailyEntries').find({ businessId: BUSINESS_ID }).toArray()
  ]);
  const salesByDate = new Map<string, { onlineSales: number; cashSales: number }>();
  for (const entry of dailyEntries) {
    const sales = salesByDate.get(entry.date) || { onlineSales: 0, cashSales: 0 };
    sales.onlineSales += Number(entry.onlineSales || 0);
    sales.cashSales += Number(entry.cashSales || 0);
    salesByDate.set(entry.date, sales);
  }

  return NextResponse.json({
    records: records.map(({ _id, ...record }) => record),
    dailySales: [...salesByDate].map(([date, sales]) => ({ date, ...sales }))
  });
}

export async function PUT(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid daily savings record.' }, { status: 400 }); }

  const date = typeof body.date === 'string' ? body.date : '';
  const onlineAmount = body.onlineAmount;
  const cashAmount = body.cashAmount;
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  if (!isValidBalanceDate(date) || typeof onlineAmount !== 'number' || !Number.isFinite(onlineAmount) || onlineAmount < 0 ||
      typeof cashAmount !== 'number' || !Number.isFinite(cashAmount) || cashAmount < 0 ||
      !Number.isFinite(onlineAmount + cashAmount) || notes.length > 300) {
    return NextResponse.json({ error: 'Enter a valid date, non-negative online and cash savings, and a note of 300 characters or fewer.' }, { status: 400 });
  }

  const db = await getDb();
  const entries = await db.collection<DailyEntry>('dailyEntries').find({ businessId: BUSINESS_ID, date }).toArray();
  const onlineSales = entries.reduce((total, entry) => total + Number(entry.onlineSales || 0), 0);
  const cashSales = entries.reduce((total, entry) => total + Number(entry.cashSales || 0), 0);
  const savedOnline = money(onlineAmount);
  const savedCash = money(cashAmount);
  if (savedOnline > onlineSales || savedCash > cashSales) {
    return NextResponse.json({ error: 'Savings cannot exceed the recorded online or cash sales for that date.' }, { status: 400 });
  }

  const collection = db.collection<DailySaving>('dailySavings');
  const id = `${BUSINESS_ID}:${date}`;
  if (savedOnline === 0 && savedCash === 0) {
    await collection.deleteOne({ _id: id, businessId: BUSINESS_ID, date });
    return NextResponse.json({ ok: true, cleared: true });
  }

  await collection.updateOne(
    { _id: id, businessId: BUSINESS_ID, date },
    {
      $set: { businessId: BUSINESS_ID, date, onlineAmount: savedOnline, cashAmount: savedCash, notes, updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date() }
    },
    { upsert: true }
  );
  return NextResponse.json({ ok: true });
}
