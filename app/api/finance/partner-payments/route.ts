import { NextResponse } from 'next/server';
import { BUSINESS_ID } from '@/lib/constants';
import { authorize } from '@/lib/authz';
import { isValidBalanceDate } from '@/lib/dashboard/balance-as-of';
import { getDb } from '@/lib/mongodb';
import type { PartnerDistribution } from '@/types/domain';

const money = (value: number) => Math.round(value * 100) / 100;
const validPeriod = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const recipientNames = ['friend', 'investors', 'investor1', 'investor2'] as const;
type Recipient = typeof recipientNames[number];

function amountPaid(record: PartnerDistribution, recipient: Recipient) {
  return money((record.payments || []).filter(payment => payment.recipient === recipient).reduce((total, payment) => total + Number(payment.amount || 0), 0));
}

function allocation(record: PartnerDistribution, recipient: Recipient) {
  if (recipient === 'friend') return record.friendAllocation;
  if (recipient === 'investors') return record.investor1Percent === undefined ? record.investorAllocation : 0;
  const percent = recipient === 'investor1' ? record.investor1Percent : record.investor2Percent;
  return percent === undefined ? 0 : money(record.investorAllocation * percent / 100);
}

export async function GET(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;
  const records = await (await getDb()).collection<PartnerDistribution>('partnerDistributions')
    .find({ businessId: BUSINESS_ID }).sort({ period: -1 }).toArray();
  return NextResponse.json(records.map(record => ({
    ...record,
    status: money((record.payments || []).reduce((total, payment) => total + Number(payment.amount || 0), 0)) >= record.approvedAmount ? 'paid' : 'pending'
  })));
}

export async function PUT(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid distribution approval.' }, { status: 400 }); }

  const period = typeof body.period === 'string' ? body.period : '';
  const approvedAmount = Number(body.approvedAmount);
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  const hasSplit = body.investor1Percent !== undefined || body.investor2Percent !== undefined;
  const investor1Percent = body.investor1Percent === undefined ? undefined : Number(body.investor1Percent);
  const investor2Percent = body.investor2Percent === undefined ? undefined : Number(body.investor2Percent);
  if (!validPeriod(period) || !Number.isFinite(approvedAmount) || approvedAmount <= 0 || notes.length > 500 ||
      (hasSplit && (!Number.isFinite(investor1Percent) || !Number.isFinite(investor2Percent) ||
        investor1Percent! < 0 || investor1Percent! > 100 || investor2Percent! < 0 || investor2Percent! > 100 ||
        Math.abs(investor1Percent! + investor2Percent! - 100) > 0.000001))) {
    return NextResponse.json({ error: 'Enter a valid approved amount and, if configured, investor percentages that total 100% of the investor allocation.' }, { status: 400 });
  }

  const db = await getDb();
  const collection = db.collection<PartnerDistribution>('partnerDistributions');
  const existing = await collection.findOne({ _id: `${BUSINESS_ID}:${period}`, businessId: BUSINESS_ID });
  const next: PartnerDistribution = {
    _id: `${BUSINESS_ID}:${period}`,
    businessId: BUSINESS_ID,
    period,
    approvedAmount: money(approvedAmount),
    friendAllocation: money(money(approvedAmount) * 0.4),
    investorAllocation: money(money(approvedAmount) - money(money(approvedAmount) * 0.4)),
    ...(hasSplit ? { investor1Percent, investor2Percent } : {}),
    payments: existing?.payments || [],
    notes,
    createdAt: existing?.createdAt || new Date(),
    updatedAt: new Date()
  };
  if (existing && hasSplit && existing.investor1Percent === undefined && amountPaid(existing, 'investors') > 0) {
    return NextResponse.json({ error: 'Configure the investor split before recording collective investor payments.' }, { status: 409 });
  }
  if (existing && !hasSplit && existing.investor1Percent !== undefined &&
      (amountPaid(existing, 'investor1') > 0 || amountPaid(existing, 'investor2') > 0)) {
    return NextResponse.json({ error: 'An individual investor split cannot be removed after individual payments are recorded.' }, { status: 409 });
  }
  if (existing && recipientNames.some(recipient => amountPaid(existing, recipient) > allocation(next, recipient))) {
    return NextResponse.json({ error: 'The new allocation cannot be lower than payments already recorded.' }, { status: 409 });
  }
  await collection.updateOne(
    { _id: `${BUSINESS_ID}:${period}`, businessId: BUSINESS_ID },
    { $set: next },
    { upsert: true }
  );
  return NextResponse.json({ ok: true, friendAllocation: next.friendAllocation, investorAllocation: next.investorAllocation });
}

export async function POST(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid partner payment.' }, { status: 400 }); }

  const period = typeof body.period === 'string' ? body.period : '';
  const recipient = body.recipient;
  const amount = Number(body.amount);
  const paymentDate = typeof body.paymentDate === 'string' ? body.paymentDate : '';
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (!validPeriod(period) || !recipientNames.includes(recipient as Recipient) || !Number.isFinite(amount) || amount <= 0 ||
      !isValidBalanceDate(paymentDate) || paymentDate.slice(0, 7) !== period || note.length > 300) {
    return NextResponse.json({ error: 'Enter a valid recipient, positive amount, payment date within the approved month, and note of 300 characters or fewer.' }, { status: 400 });
  }

  const db = await getDb();
  const collection = db.collection<PartnerDistribution>('partnerDistributions');
  const record = await collection.findOne({ _id: `${BUSINESS_ID}:${period}`, businessId: BUSINESS_ID });
  if (!record) return NextResponse.json({ error: 'Approve a monthly distribution before recording payments.' }, { status: 409 });
  const payment = { recipient: recipient as Recipient, amount: money(amount), paymentDate, ...(note ? { note } : {}) };
  if (record.investor1Percent === undefined && (recipient === 'investor1' || recipient === 'investor2')) {
    return NextResponse.json({ error: 'Configure the investors’ agreed split before recording individual investor payments.' }, { status: 409 });
  }
  if (record.investor1Percent !== undefined && recipient === 'investors') {
    return NextResponse.json({ error: 'Select an individual investor because the split is configured.' }, { status: 409 });
  }
  if ((record.payments || []).some(existing =>
    existing.recipient === payment.recipient &&
    existing.amount === payment.amount &&
    existing.paymentDate === payment.paymentDate
  )) {
    return NextResponse.json({ error: 'This payment is already recorded. Refresh and retry.' }, { status: 409 });
  }
  const remaining = money(allocation(record, payment.recipient) - amountPaid(record, payment.recipient));
  if (payment.amount > remaining) return NextResponse.json({ error: 'Payment exceeds the approved allocation remaining for this recipient.' }, { status: 400 });

  const result = await collection.updateOne(
    {
      _id: `${BUSINESS_ID}:${period}`,
      businessId: BUSINESS_ID,
      payments: { $not: { $elemMatch: { recipient: payment.recipient, amount: payment.amount, paymentDate: payment.paymentDate } } }
    },
    { $push: { payments: payment } as never, $set: { updatedAt: new Date() } }
  );
  if (!result.matchedCount) return NextResponse.json({ error: 'This payment is already recorded or the distribution changed. Refresh and retry.' }, { status: 409 });
  return NextResponse.json({ ok: true }, { status: 201 });
}
