import { NextResponse } from 'next/server';
import { DailySavingsConflictError, listDaily, upsertDaily } from '@/lib/dashboard/repository';
import { isValidBalanceDate } from '@/lib/dashboard/balance-as-of';
import { authorize, getRequestUser } from '@/lib/authz';
export async function GET(request: Request) {
  const denied = authorize(request, 'viewer');
  if (denied) return denied;
  const rows = await listDaily();
  if (getRequestUser(request)?.role === 'owner') return NextResponse.json(rows);
  return NextResponse.json(rows.map(entry => ({
    id: String(entry._id),
    date: entry.date,
    onlineSales: entry.onlineSales,
    cashSales: entry.cashSales,
    totalSales: Number(entry.onlineSales || 0) + Number(entry.cashSales || 0)
  })));
}
export async function POST(req: Request) {
  const denied = authorize(req);
  if (denied) return denied;
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid daily entry data.' }, { status: 400 }); }
  if (typeof b.date !== 'string' || !isValidBalanceDate(b.date)) return NextResponse.json({ error: 'A valid date is required.' }, { status: 400 });
  try {
    const id = await upsertDaily({date:b.date,onlineSales:Number(b.onlineSales||0),cashSales:Number(b.cashSales||0),expenses:(b.expenses||{}) as Record<string, number>,expensePaidOnline:Number(b.expensePaidOnline||0),expensePaidCash:Number(b.expensePaidCash||0),notes:String(b.notes||'')});
    return NextResponse.json({id});
  } catch (error) {
    if (error instanceof DailySavingsConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
