import { NextRequest, NextResponse } from 'next/server';
import { getBalanceAsOf, isValidBalanceDate } from '@/lib/dashboard/balance-as-of';
import { authorize } from '@/lib/authz';

export async function GET(request: NextRequest) {
  const denied = authorize(request);
  if (denied) return denied;
  const date = request.nextUrl.searchParams.get('date') || '';
  if (!isValidBalanceDate(date)) return NextResponse.json({ error: 'Enter a valid balance date.' }, { status: 400 });
  return NextResponse.json({ date, balances: await getBalanceAsOf(date) });
}
