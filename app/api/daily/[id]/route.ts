import { NextResponse } from 'next/server';
import { DailySavingsConflictError, deleteDaily, upsertDaily } from '@/lib/dashboard/repository';
import { isValidBalanceDate } from '@/lib/dashboard/balance-as-of';
import { authorize } from '@/lib/authz';
type Ctx={params:Promise<{id:string}>};
export async function PATCH(req:Request,ctx:Ctx){
  const denied = authorize(req);
  if (denied) return denied;
  const {id}=await ctx.params;
  let b: Record<string, unknown>;
  try { b=await req.json(); } catch { return NextResponse.json({ error: 'Invalid daily entry data.' }, { status: 400 }); }
  if (typeof b.date !== 'string' || !isValidBalanceDate(b.date)) return NextResponse.json({ error: 'A valid date is required.' }, { status: 400 });
  const expenses = typeof b.expenses === 'object' && b.expenses !== null && !Array.isArray(b.expenses) ? b.expenses as Record<string, number> : {};
  try {
    const updated = await upsertDaily({date:b.date,onlineSales:Number(b.onlineSales||0),cashSales:Number(b.cashSales||0),expenses,expensePaidOnline:Number(b.expensePaidOnline||0),expensePaidCash:Number(b.expensePaidCash||0),notes:String(b.notes||'')},id);
    if (!updated) return NextResponse.json({ error: 'Daily entry not found.' }, { status: 404 });
    return NextResponse.json({ok:true});
  } catch (error) {
    if (error instanceof DailySavingsConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
export async function DELETE(_req:Request,ctx:Ctx){
  const denied = authorize(_req);
  if (denied) return denied;
  const {id}=await ctx.params;
  try {
    const deleted=await deleteDaily(id);
    if (!deleted) return NextResponse.json({ error: 'Daily entry not found.' }, { status: 404 });
    return NextResponse.json({ok:true});
  } catch (error) {
    if (error instanceof DailySavingsConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
