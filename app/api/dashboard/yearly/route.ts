import { NextResponse } from 'next/server';
import { authorize, getRequestUser } from '@/lib/authz';
import { getViewerYearlyDashboard, getYearlyDashboard } from '@/lib/dashboard/metrics';
export async function GET(req:Request){
  const denied = authorize(req, 'viewer');
  if (denied) return denied;
  const url = new URL(req.url);
  const year = Number(url.searchParams.get('year') || new Date().getFullYear());
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return NextResponse.json({ error: 'Enter a valid dashboard year.' }, { status: 400 });
  return NextResponse.json(getRequestUser(req)?.role === 'owner'
    ? await getYearlyDashboard(year)
    : await getViewerYearlyDashboard(year));
}
