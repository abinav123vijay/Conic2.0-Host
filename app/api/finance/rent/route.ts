import { NextResponse } from 'next/server';
import { BUSINESS_ID } from '@/lib/constants';
import { authorize } from '@/lib/authz';
import { isValidBalanceDate } from '@/lib/dashboard/balance-as-of';
import { getDb } from '@/lib/mongodb';
import type { RentPayment } from '@/types/domain';

function validPeriod(value: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export async function GET(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;
  const records = await (await getDb()).collection<RentPayment>('rentPayments')
    .find({ businessId: BUSINESS_ID }).sort({ period: -1 }).toArray();
  return NextResponse.json(records.map(({ _id, ...record }) => record));
}

export async function PUT(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid rent record.' }, { status: 400 }); }

  const period = typeof body.period === 'string' ? body.period : '';
  const amount = Number(body.amount);
  const paymentDate = typeof body.paymentDate === 'string' ? body.paymentDate : '';
  const status = body.status;
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  if (!validPeriod(period) || !Number.isFinite(amount) || amount <= 0 ||
      !isValidBalanceDate(paymentDate) || paymentDate.slice(0, 7) !== period ||
      (status !== 'paid' && status !== 'pending') || notes.length > 500) {
    return NextResponse.json({ error: 'Enter a positive rent amount, valid monthly payment date, status, and notes of 500 characters or fewer.' }, { status: 400 });
  }

  const db = await getDb();
  await db.collection<RentPayment>('rentPayments').updateOne(
    { _id: `${BUSINESS_ID}:${period}`, businessId: BUSINESS_ID, period },
    {
      $set: { businessId: BUSINESS_ID, period, amount, paymentDate, status, notes, updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date() }
    },
    { upsert: true }
  );
  return NextResponse.json({ ok: true });
}
