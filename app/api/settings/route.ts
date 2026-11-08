import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { BUSINESS_ID, DEFAULT_EXPENSE_CATEGORIES, DEFAULT_VENDORS } from '@/lib/constants';
import { authorize } from '@/lib/authz';
export async function GET(req:NextRequest){
  const denied = authorize(req);
  if (denied) return denied;
  const db=await getDb();
  const businesses=db.collection<{_id:string;name?:string;openingOnlineBalance?:number;openingCashBalance?:number;vendors?:string[];expenseCategories?:string[]}>('businesses');
  const d=await businesses.findOne({_id:BUSINESS_ID});
  return NextResponse.json({
    name:d?.name||'CONIC Truck 2',
    openingOnlineBalance:Number(d?.openingOnlineBalance||0),
    openingCashBalance:Number(d?.openingCashBalance||0),
    vendors:d?.vendors||DEFAULT_VENDORS,
    expenseCategories:d?.expenseCategories||DEFAULT_EXPENSE_CATEGORIES
  });
}
export async function PUT(req:Request){
  const denied = authorize(req);
  if (denied) return denied;
  const b=await req.json();
  const db=await getDb();
  const businesses=db.collection<{_id:string;name?:string;openingOnlineBalance?:number;openingCashBalance?:number;vendors?:string[];expenseCategories?:string[]}>('businesses');
  await businesses.updateOne({_id:BUSINESS_ID},{$set:{
    name:String(b.name||'CONIC Truck 2'),
    openingOnlineBalance:Number(b.openingOnlineBalance||0),
    openingCashBalance:Number(b.openingCashBalance||0),
    vendors:Array.isArray(b.vendors)?b.vendors.map(String):DEFAULT_VENDORS,
    expenseCategories:Array.isArray(b.expenseCategories)?b.expenseCategories.map(String):DEFAULT_EXPENSE_CATEGORIES,
    updatedAt:new Date()
  }},{upsert:true});
  return NextResponse.json({ok:true});
}
