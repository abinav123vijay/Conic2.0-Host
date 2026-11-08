import { NextResponse } from 'next/server';
import { exportWorkbook } from '@/lib/excel/export';
import { authorize } from '@/lib/authz';
export const runtime='nodejs';
export async function GET(request:Request){
  const denied = authorize(request);
  if (denied) return denied;
  const file=await exportWorkbook({includeReconciliation:true});
  return new NextResponse(new Uint8Array(file),{status:200,headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="CONIC_Business_Tracker.xlsx"','Cache-Control':'no-store'}});
}
