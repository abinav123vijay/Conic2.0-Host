import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { BUSINESS_ID } from '@/lib/constants';
import { parseConicWorkbook } from '@/lib/excel/parse';
import { authorize } from '@/lib/authz';

export const runtime = 'nodejs';
type BusinessRecord = { _id: string; name: string; openingOnlineBalance: number; openingCashBalance: number; vendors: string[]; expenseCategories: string[]; updatedAt: Date };

export async function POST(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'Excel file is required' }, { status: 400 });

  let parsed: ReturnType<typeof parseConicWorkbook>;
  try {
    parsed = parseConicWorkbook(Buffer.from(await file.arrayBuffer()), BUSINESS_ID);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The workbook could not be read.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
  const db = await getDb();
  const now = new Date();
  await db.collection<BusinessRecord>('businesses').updateOne(
    { _id: BUSINESS_ID },
    { $set: { name: parsed.settings.name, openingOnlineBalance: parsed.settings.openingOnlineBalance, openingCashBalance: parsed.settings.openingCashBalance, vendors: parsed.settings.vendors, expenseCategories: parsed.settings.expenseCategories, updatedAt: now } },
    { upsert: true }
  );

  await db.collection('dailyEntries').deleteMany({ businessId: BUSINESS_ID });
  const dailyDocuments=parsed.dailyEntries.map(({ _id, ...entry }) => ({ ...entry, createdAt: now, updatedAt: now }));
  if (dailyDocuments.length) await db.collection('dailyEntries').insertMany(dailyDocuments);

  await db.collection('purchaseEntries').deleteMany({ businessId: BUSINESS_ID });
  const purchaseDocuments=parsed.purchaseEntries.map(({ _id, ...entry }) => ({ ...entry, createdAt: now, updatedAt: now }));
  if (purchaseDocuments.length) await db.collection('purchaseEntries').insertMany(purchaseDocuments);

  return NextResponse.json({
    ok: true,
    daily: parsed.dailyEntries.length,
    purchases: parsed.purchaseEntries.length,
    vendors: parsed.settings.vendors.length,
  });
}
