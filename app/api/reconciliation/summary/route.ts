import { NextRequest, NextResponse } from 'next/server';
import { BUSINESS_ID } from '@/lib/constants';
import { getDb } from '@/lib/mongodb';
import { isValidBalanceDate } from '@/lib/dashboard/balance-as-of';
import { authorize } from '@/lib/authz';

type ReconciliationSummaryRecord = {
  date: string;
  bookOnline: number;
  bookCash: number;
  actualOnline: number;
  actualCash: number;
  varianceOnline: number;
  varianceCash: number;
  updatedAt: Date;
};

export async function GET(request: NextRequest) {
  const denied = authorize(request);
  if (denied) return denied;
  const today = request.nextUrl.searchParams.get('date') || '';
  if (!isValidBalanceDate(today)) {
    return NextResponse.json({ error: 'A valid date is required to check reconciliation status.' }, { status: 400 });
  }

  const db = await getDb();
  const reconciliations = db.collection<ReconciliationSummaryRecord>('accountReconciliations');
  const mismatchFilter = {
    businessId: BUSINESS_ID,
    $expr: { $or: [{ $ne: ['$actualOnline', '$bookOnline'] }, { $ne: ['$actualCash', '$bookCash'] }] }
  };
  const [todayReconciliation, latest, mismatchCount, mismatches] = await Promise.all([
    reconciliations.findOne({ businessId: BUSINESS_ID, date: today }),
    reconciliations.find({ businessId: BUSINESS_ID }).sort({ date: -1 }).limit(1).next(),
    reconciliations.countDocuments(mismatchFilter),
    reconciliations.find(mismatchFilter).sort({ date: -1 }).limit(10).toArray()
  ]);

  return NextResponse.json({
    today,
    reconciledToday: Boolean(todayReconciliation),
    todayReconciliation,
    latest,
    mismatchCount,
    mismatches: mismatches.map(item => ({
      ...item,
      varianceOnline: Number(item.actualOnline) - Number(item.bookOnline),
      varianceCash: Number(item.actualCash) - Number(item.bookCash)
    }))
  });
}
