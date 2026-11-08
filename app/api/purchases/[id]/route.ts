import { NextResponse } from 'next/server';
import { deletePurchase, upsertPurchase } from '@/lib/dashboard/repository';
import { isValidBalanceDate } from '@/lib/dashboard/balance-as-of';
import { authorize } from '@/lib/authz';
type Ctx={params:Promise<{id:string}>};
export async function PATCH(req:Request,ctx:Ctx){
  const denied = authorize(req);
  if (denied) return denied;
  const {id}=await ctx.params;
  let b: Record<string, unknown>;
  try { b=await req.json(); } catch { return NextResponse.json({ error: 'Invalid purchase data.' }, { status: 400 }); }
  if (typeof b.purchaseDate !== 'string' || !isValidBalanceDate(b.purchaseDate)) return NextResponse.json({ error: 'A valid purchaseDate is required.' }, { status: 400 });
  if (b.paymentDate && (typeof b.paymentDate !== 'string' || !isValidBalanceDate(b.paymentDate))) return NextResponse.json({ error: 'A valid paymentDate is required.' }, { status: 400 });
  const updated=await upsertPurchase({purchaseDate:b.purchaseDate,paymentDate:typeof b.paymentDate === 'string' ? b.paymentDate : null,vendorAmounts:(typeof b.vendorAmounts === 'object' && b.vendorAmounts !== null && !Array.isArray(b.vendorAmounts) ? b.vendorAmounts : {}) as Record<string, number>,onlinePurchasePaid:Number(b.onlinePurchasePaid||0),cashPurchasePaid:Number(b.cashPurchasePaid||0)},id);
  if (!updated) return NextResponse.json({ error: 'Purchase entry not found.' }, { status: 404 });
  return NextResponse.json({ok:true});
}
export async function DELETE(_req:Request,ctx:Ctx){
  const denied = authorize(_req);
  if (denied) return denied;
  const {id}=await ctx.params;
  const deleted=await deletePurchase(id);
  if (!deleted) return NextResponse.json({ error: 'Purchase entry not found.' }, { status: 404 });
  return NextResponse.json({ok:true});
}
