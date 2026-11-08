import { getDb } from '@/lib/mongodb';
import { BUSINESS_ID } from '@/lib/constants';
import { calculateBalancesThrough } from '@/lib/finance/balances';
import type { BusinessSettings, DailyEntry, DailySaving, PurchaseEntry } from '@/types/domain';

export function isValidBalanceDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function getBalanceAsOf(date: string) {
  const db = await getDb();
  const [business, daily, purchases, savings] = await Promise.all([
    db.collection<Pick<BusinessSettings, '_id' | 'openingOnlineBalance' | 'openingCashBalance'>>('businesses')
      .findOne({ _id: BUSINESS_ID }),
    db.collection<DailyEntry>('dailyEntries').find({ businessId: BUSINESS_ID, date: { $lte: date } }).sort({ date: 1 }).toArray(),
    db.collection<PurchaseEntry>('purchaseEntries').find({
      businessId: BUSINESS_ID,
      $or: [{ paymentDate: { $lte: date } }, { paymentDate: null, purchaseDate: { $lte: date } }]
    }).sort({ purchaseDate: 1 }).toArray(),
    db.collection<DailySaving>('dailySavings').find({ businessId: BUSINESS_ID, date: { $lte: date } }).toArray()
  ]);
  const savingsByDate = new Map(savings.map(item => [item.date, item]));
  const dailyWithSavings = daily.map(entry => {
    const saved = savingsByDate.get(entry.date);
    return { ...entry, savingsOnline: saved?.onlineAmount || 0, savingsCash: saved?.cashAmount || 0 };
  });

  const balances = calculateBalancesThrough(
    date,
    dailyWithSavings,
    purchases,
    {
      online: Number(business?.openingOnlineBalance || 0),
      cash: Number(business?.openingCashBalance || 0)
    },
    [],
    [],
    []
  );
  return { online: balances.online, cash: balances.cash, total: balances.total };
}
