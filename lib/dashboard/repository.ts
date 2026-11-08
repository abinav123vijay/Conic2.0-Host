import { ObjectId } from 'mongodb';
import { BUSINESS_ID } from '@/lib/constants';
import { getDb } from '@/lib/mongodb';
import type { DailyEntry, DailySaving, PurchaseEntry } from '@/types/domain';

const clean = (x: unknown) => (x === undefined || x === null ? '' : x);
type StoredDailyEntry = Omit<DailyEntry, '_id' | 'createdAt' | 'updatedAt'> & {
  _id?: ObjectId;
  createdAt?: Date | string;
  updatedAt?: Date | string;
};

export class DailySavingsConflictError extends Error {
  constructor() {
    super('Daily sales cannot be reduced below savings already recorded for that date.');
    this.name = 'DailySavingsConflictError';
  }
}

async function savingsAreCovered(
  date: string,
  include?: Pick<DailyEntry, 'onlineSales' | 'cashSales'>,
  excludeId?: ObjectId
) {
  const db = await getDb();
  const entries = await db.collection<StoredDailyEntry>('dailyEntries').find({ businessId: BUSINESS_ID, date }).toArray();
  const remaining = entries.filter(entry => !excludeId || !(entry._id instanceof ObjectId) || !excludeId.equals(entry._id));
  const onlineSales = remaining.reduce((total, entry) => total + Number(entry.onlineSales || 0), Number(include?.onlineSales || 0));
  const cashSales = remaining.reduce((total, entry) => total + Number(entry.cashSales || 0), Number(include?.cashSales || 0));
  const savings = await db.collection<DailySaving>('dailySavings').findOne({ businessId: BUSINESS_ID, date });
  return !savings || (Number(savings.onlineAmount || 0) <= onlineSales && Number(savings.cashAmount || 0) <= cashSales);
}

export async function listDaily() {
  const db = await getDb();
  return db.collection<DailyEntry>('dailyEntries').find({ businessId: BUSINESS_ID }).sort({ date: 1 }).toArray();
}
export async function upsertDaily(payload: Omit<DailyEntry, '_id'|'businessId'|'createdAt'|'updatedAt'>, id?: string) {
  const db = await getDb(); const now = new Date();
  const doc = { ...payload, businessId: BUSINESS_ID, updatedAt: now };
  if (id) {
    if (!ObjectId.isValid(id)) return null;
    const objectId = new ObjectId(id);
    const collection = db.collection<StoredDailyEntry>('dailyEntries');
    const existing = await collection.findOne({ _id: objectId, businessId: BUSINESS_ID });
    if (!existing) return null;
    if (existing.date !== payload.date && !(await savingsAreCovered(existing.date, undefined, objectId))) {
      throw new DailySavingsConflictError();
    }
    if (!(await savingsAreCovered(payload.date, payload, objectId))) throw new DailySavingsConflictError();
    const result = await collection.updateOne({ _id: objectId, businessId: BUSINESS_ID }, { $set: doc });
    return result.matchedCount ? id : null;
  }
  if (!(await savingsAreCovered(payload.date, payload))) throw new DailySavingsConflictError();
  const result = await db.collection<StoredDailyEntry>('dailyEntries').insertOne({ ...doc, createdAt: now }); return result.insertedId.toString();
}
export async function deleteDaily(id: string) {
  if (!ObjectId.isValid(id)) return false;
  const db = await getDb();
  const objectId = new ObjectId(id);
  const collection = db.collection<StoredDailyEntry>('dailyEntries');
  const existing = await collection.findOne({ _id: objectId, businessId: BUSINESS_ID });
  if (!existing) return false;
  if (!(await savingsAreCovered(existing.date, undefined, objectId))) throw new DailySavingsConflictError();
  const result = await collection.deleteOne({ _id: objectId, businessId: BUSINESS_ID });
  return result.deletedCount > 0;
}

export async function listPurchases() {
  const db = await getDb();
  return db.collection<PurchaseEntry>('purchaseEntries').find({ businessId: BUSINESS_ID }).sort({ purchaseDate: 1 }).toArray();
}
export async function upsertPurchase(payload: Omit<PurchaseEntry, '_id'|'businessId'|'createdAt'|'updatedAt'>, id?: string) {
  const db = await getDb(); const now = new Date();
  const doc = { ...payload, businessId: BUSINESS_ID, paymentDate: clean(payload.paymentDate) || null, updatedAt: now };
  if (id) {
    if (!ObjectId.isValid(id)) return null;
    const result = await db.collection('purchaseEntries').updateOne({ _id: new ObjectId(id), businessId: BUSINESS_ID }, { $set: doc });
    return result.matchedCount ? id : null;
  }
  const result = await db.collection('purchaseEntries').insertOne({ ...doc, createdAt: now }); return result.insertedId.toString();
}
export async function deletePurchase(id: string) {
  if (!ObjectId.isValid(id)) return false;
  const db = await getDb();
  const result = await db.collection('purchaseEntries').deleteOne({ _id: new ObjectId(id), businessId: BUSINESS_ID });
  return result.deletedCount > 0;
}
