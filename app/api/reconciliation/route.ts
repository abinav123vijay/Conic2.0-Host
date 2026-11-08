import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { BUSINESS_ID } from '@/lib/constants';
import { getBalanceAsOf, isValidBalanceDate } from '@/lib/dashboard/balance-as-of';
import { authorize } from '@/lib/authz';

type ReconciliationRecord = {
  businessId: string;
  date: string;
  bookOnline: number;
  bookCash: number;
  actualOnline: number;
  actualCash: number;
  varianceOnline: number;
  varianceCash: number;
  notes: string;
  reconciledAt: Date;
  updatedAt: Date;
};

export async function GET(request: NextRequest) {
  const denied = authorize(request);
  if (denied) return denied;
  const date = request.nextUrl.searchParams.get('date') || '';
  if (!isValidBalanceDate(date)) return NextResponse.json({ error: 'Enter a valid reconciliation date.' }, { status: 400 });

  const db = await getDb();
  const [balances, saved, history] = await Promise.all([
    getBalanceAsOf(date),
    db.collection<ReconciliationRecord>('accountReconciliations').findOne({ businessId: BUSINESS_ID, date }),
    db.collection<ReconciliationRecord>('accountReconciliations')
      .find({ businessId: BUSINESS_ID })
      .sort({ date: -1 })
      .limit(30)
      .toArray()
  ]);

  return NextResponse.json({
    date,
    calculated: balances,
    saved,
    history
  });
}

export async function POST(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid reconciliation data.' }, { status: 400 });
  }

  const date = typeof body.date === 'string' ? body.date : '';
  if (body.notes !== undefined && typeof body.notes !== 'string') {
    return NextResponse.json({ error: 'Notes must be text.' }, { status: 400 });
  }
  if (typeof body.actualOnline !== 'number' && (typeof body.actualOnline !== 'string' || body.actualOnline.trim() === '')) {
    return NextResponse.json({ error: 'Enter a verified online/bank balance.' }, { status: 400 });
  }
  if (typeof body.actualCash !== 'number' && (typeof body.actualCash !== 'string' || body.actualCash.trim() === '')) {
    return NextResponse.json({ error: 'Enter a verified cash-in-hand balance.' }, { status: 400 });
  }
  const actualOnline = Number(body.actualOnline);
  const actualCash = Number(body.actualCash);
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  if (
    !isValidBalanceDate(date) ||
    !Number.isFinite(actualOnline) ||
    actualOnline < 0 ||
    !Number.isFinite(actualCash) ||
    actualCash < 0 ||
    notes.length > 500
  ) {
    return NextResponse.json({ error: 'Enter a valid date and non-negative online and cash balances. Notes must be 500 characters or fewer.' }, { status: 400 });
  }

  const balances = await getBalanceAsOf(date);
  const now = new Date();
  const record: ReconciliationRecord = {
    businessId: BUSINESS_ID,
    date,
    bookOnline: balances.online,
    bookCash: balances.cash,
    actualOnline,
    actualCash,
    varianceOnline: actualOnline - balances.online,
    varianceCash: actualCash - balances.cash,
    notes,
    reconciledAt: now,
    updatedAt: now
  };

  const db = await getDb();
  const reconciliations = db.collection<ReconciliationRecord>('accountReconciliations');
  await reconciliations.createIndex({ businessId: 1, date: 1 }, { unique: true });
  await reconciliations.updateOne(
    { businessId: BUSINESS_ID, date },
    { $set: record },
    { upsert: true }
  );

  return NextResponse.json({ ok: true, reconciliation: record });
}
