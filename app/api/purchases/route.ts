import { NextResponse } from 'next/server';
import { listPurchases, upsertPurchase } from '@/lib/dashboard/repository';
import { isValidBalanceDate } from '@/lib/dashboard/balance-as-of';
import { authorize, getRequestUser } from '@/lib/authz';
import { getViewerVendorNames } from '@/lib/dashboard/metrics';
export async function GET(request: Request){
  const denied = authorize(request, 'viewer');
  if (denied) return denied;
  const rows = await listPurchases();
  if (getRequestUser(request)?.role === 'owner') return NextResponse.json(rows);
  const vendors = await getViewerVendorNames();
  return NextResponse.json(rows.map(purchase => {
    const vendorAmounts = Object.fromEntries(Object.entries(purchase.vendorAmounts || {}).filter(([name]) => vendors.has(name)));
    return {
      id: String(purchase._id),
      purchaseDate: purchase.purchaseDate,
      vendorAmounts,
      totalPurchases: Object.values(vendorAmounts).reduce((sum, value) => sum + Number(value || 0), 0)
    };
  }));
}
export async function POST(req:Request){
  const denied = authorize(req);
  if (denied) return denied;
  let b: Record<string, unknown>;
  try { b=await req.json(); } catch { return NextResponse.json({ error: 'Invalid purchase data.' }, { status: 400 }); }
  if (typeof b.purchaseDate !== 'string' || !isValidBalanceDate(b.purchaseDate)) return NextResponse.json({error:'A valid purchaseDate is required.'},{status:400});
  if (b.paymentDate && (typeof b.paymentDate !== 'string' || !isValidBalanceDate(b.paymentDate))) return NextResponse.json({ error: 'A valid paymentDate is required.' }, { status: 400 });
  const id=await upsertPurchase({purchaseDate:b.purchaseDate,paymentDate:typeof b.paymentDate === 'string' ? b.paymentDate : null,vendorAmounts:(typeof b.vendorAmounts === 'object' && b.vendorAmounts !== null && !Array.isArray(b.vendorAmounts) ? b.vendorAmounts : {}) as Record<string, number>,onlinePurchasePaid:Number(b.onlinePurchasePaid||0),cashPurchasePaid:Number(b.cashPurchasePaid||0)});
  return NextResponse.json({id});
}
