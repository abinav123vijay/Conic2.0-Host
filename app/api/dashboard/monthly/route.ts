import { NextRequest, NextResponse } from 'next/server';
import { authorize, getRequestUser } from '@/lib/authz';
import { getMonthlyDashboard, getViewerMonthlyDashboard } from '@/lib/dashboard/metrics';

export async function GET(request: NextRequest) {
  const denied = authorize(request, 'viewer');
  if (denied) return denied;
  const searchParams = request.nextUrl.searchParams;
  const now = new Date();
  const year = Number(searchParams.get('year') || now.getFullYear());
  const month = Number(searchParams.get('month') || now.getMonth() + 1);
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: 'Enter a valid dashboard month.' }, { status: 400 });
  }
  const isOwner = getRequestUser(request)?.role === 'owner';
  return NextResponse.json(isOwner
    ? await getMonthlyDashboard(year, month)
    : await getViewerMonthlyDashboard(year, month));
}
