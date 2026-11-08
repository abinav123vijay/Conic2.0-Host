import { getDb } from '@/lib/mongodb';
import { BUSINESS_ID, DEFAULT_EXPENSE_CATEGORIES, DEFAULT_VENDORS, isoMonthEnd, isoMonthStart, MONTHS } from '@/lib/constants';
import { getBalanceAsOf } from '@/lib/dashboard/balance-as-of';
import type { BusinessSettings, DailyEntry, MonthlyDashboard, PartnerDistribution, PurchaseEntry, RentPayment, ViewerMonthlyDashboard, ViewerYearlyDashboard, YearlyDashboard } from '@/types/domain';

const sum = (values: number[]) => values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
const amount = (value: unknown) => Number(value || 0);
const salesTotal = (entry: DailyEntry) => amount(entry.onlineSales) + amount(entry.cashSales);
const expenseTotal = (entry: DailyEntry) => sum(Object.values(entry.expenses || {}).map(amount));
const purchaseTotal = (entry: PurchaseEntry) => sum(Object.values(entry.vendorAmounts || {}).map(amount));
const approvedPurchaseTotal = (entry: PurchaseEntry, vendors: Set<string>) =>
  sum(Object.entries(entry.vendorAmounts || {}).filter(([name]) => vendors.has(name)).map(([, value]) => amount(value)));

export async function getSettings(): Promise<BusinessSettings> {
  const db = await getDb();
  const doc = await db.collection<{
    _id: string;
    name?: string;
    openingOnlineBalance?: number;
    openingCashBalance?: number;
    vendors?: string[];
    expenseCategories?: string[];
    updatedAt?: Date;
  }>('businesses').findOne({ _id: BUSINESS_ID });
  return {
    _id: BUSINESS_ID,
    name: String(doc?.name || 'CONIC Truck 2'),
    currency: 'INR',
    dateFormat: 'DD-MMM-YYYY',
    openingOnlineBalance: amount(doc?.openingOnlineBalance),
    openingCashBalance: amount(doc?.openingCashBalance),
    vendors: Array.isArray(doc?.vendors) && doc.vendors.length ? doc.vendors : DEFAULT_VENDORS,
    expenseCategories: Array.isArray(doc?.expenseCategories) && doc.expenseCategories.length ? doc.expenseCategories : DEFAULT_EXPENSE_CATEGORIES,
    updatedAt: doc?.updatedAt?.toISOString?.() || undefined
  };
}

export async function getViewerVendorNames() {
  return new Set((await getSettings()).vendors.filter(name => name !== 'Other' && name !== 'Transport'));
}

async function loadMonthlyData(year: number, month: number) {
  const db = await getDb();
  const start = isoMonthStart(year, month);
  const end = isoMonthEnd(year, month);
  const [settings, daily, purchases, rent] = await Promise.all([
    getSettings(),
    db.collection<DailyEntry>('dailyEntries').find({ businessId: BUSINESS_ID, date: { $gte: start, $lte: end } }).sort({ date: 1 }).toArray(),
    db.collection<PurchaseEntry>('purchaseEntries').find({ businessId: BUSINESS_ID, purchaseDate: { $gte: start, $lte: end } }).sort({ purchaseDate: 1 }).toArray(),
    db.collection<RentPayment>('rentPayments').findOne({ businessId: BUSINESS_ID, period: `${year}-${String(month).padStart(2, '0')}` })
  ]);
  return { settings, daily, purchases, rent };
}

export async function getMonthlyDashboard(year: number, month: number): Promise<MonthlyDashboard> {
  const { settings, daily, purchases, rent } = await loadMonthlyData(year, month);
  const onlineSales = sum(daily.map(entry => amount(entry.onlineSales)));
  const cashSales = sum(daily.map(entry => amount(entry.cashSales)));
  const dailySalary = sum(daily.map(entry => amount(entry.expenses?.Salary)));
  const dailyOperatingExpenses = sum(daily.map(entry =>
    sum(Object.entries(entry.expenses || {}).filter(([name]) => name !== 'Salary').map(([, value]) => amount(value)))
  ));
  const totalPurchases = sum(purchases.map(purchaseTotal));
  const rentAmount = amount(rent?.amount);
  const totalSales = onlineSales + cashSales;
  const totalExpenses = dailySalary + dailyOperatingExpenses + rentAmount;
  const periodStart = isoMonthStart(year, month);
  const periodEnd = isoMonthEnd(year, month);
  const latest = daily.at(-1);
  const vendors = [...new Set([...settings.vendors, ...purchases.flatMap(entry => Object.keys(entry.vendorAmounts || {}))])];
  const vendorPurchases = vendors.map(name => ({
    name,
    amount: sum(purchases.map(purchase => amount(purchase.vendorAmounts?.[name])))
  })).filter(item => item.amount > 0);
  const otherPurchases = sum(purchases.map(purchase => amount(purchase.vendorAmounts?.Other)));
  const transportPurchases = sum(purchases.map(purchase => amount(purchase.vendorAmounts?.Transport)));
  const paid = sum(purchases.map(purchase => amount(purchase.onlinePurchasePaid) + amount(purchase.cashPurchasePaid)));
  const period = `${year}-${String(month).padStart(2, '0')}`;
  const partnerDistribution = await (await getDb()).collection<PartnerDistribution>('partnerDistributions')
    .findOne({ businessId: BUSINESS_ID, period });
  const balance = await getBalanceAsOf(periodEnd);
  const previousDate = new Date(`${periodStart}T00:00:00Z`);
  previousDate.setUTCDate(previousDate.getUTCDate() - 1);
  const opening = await getBalanceAsOf(previousDate.toISOString().slice(0, 10));

  return {
    year,
    month,
    onlineSales,
    cashSales,
    totalSales,
    totalPurchases,
    totalExpenses,
    totalBalance: balance.total,
    netAmount: totalSales - totalPurchases - totalExpenses,
    dailySalary,
    dailyOperatingExpenses,
    rent: rentAmount,
    latestDay: latest
      ? { date: latest.date, sales: salesTotal(latest), expenses: expenseTotal(latest), net: salesTotal(latest) - expenseTotal(latest) }
      : { date: null, sales: 0, expenses: 0, net: 0 },
    daily: Array.from({ length: new Date(Date.UTC(year, month, 0)).getUTCDate() }, (_, index) => {
      const day = index + 1;
      const entries = daily.filter(entry => Number(entry.date.slice(8, 10)) === day);
      return {
        day,
        label: String(day),
        sales: sum(entries.map(salesTotal)),
        onlineSales: sum(entries.map(entry => amount(entry.onlineSales))),
        cashSales: sum(entries.map(entry => amount(entry.cashSales))),
        expenses: sum(entries.map(expenseTotal))
      };
    }),
    expenseBreakdown: [
      ...[...new Set([...settings.expenseCategories, ...daily.flatMap(entry => Object.keys(entry.expenses || {}))])]
        .map(name => ({ name, amount: sum(daily.map(entry => amount(entry.expenses?.[name]))) })),
      ...(rentAmount > 0 ? [{ name: 'Rent', amount: rentAmount }] : [])
    ].filter(item => item.amount > 0),
    vendorPurchases,
    purchaseRelatedExpenses: {
      other: otherPurchases,
      transport: transportPurchases,
      total: otherPurchases + transportPurchases,
      purchaseOutflow: totalPurchases
    },
    purchaseStatus: { paid, pending: Math.max(0, totalPurchases - paid) },
    opening: { online: opening.online, cash: opening.cash },
    closing: { online: balance.online, cash: balance.cash },
    approvedDistribution: amount(partnerDistribution?.approvedAmount)
  } as MonthlyDashboard;
}

export async function getViewerMonthlyDashboard(year: number, month: number): Promise<ViewerMonthlyDashboard> {
  const { daily, purchases } = await loadMonthlyData(year, month);
  const vendors = await getViewerVendorNames();
  const onlineSales = sum(daily.map(entry => amount(entry.onlineSales)));
  const cashSales = sum(daily.map(entry => amount(entry.cashSales)));
  const totalSales = onlineSales + cashSales;
  const totalPurchases = sum(purchases.map(purchase => approvedPurchaseTotal(purchase, vendors)));
  return {
    year,
    month,
    totalSales,
    onlineSales,
    cashSales,
    totalPurchases,
    salesAfterPurchases: totalSales - totalPurchases,
    daily: Array.from({ length: new Date(Date.UTC(year, month, 0)).getUTCDate() }, (_, index) => {
      const day = index + 1;
      const entries = daily.filter(entry => Number(entry.date.slice(8, 10)) === day);
      return {
        day,
        label: String(day),
        sales: sum(entries.map(salesTotal)),
        onlineSales: sum(entries.map(entry => amount(entry.onlineSales))),
        cashSales: sum(entries.map(entry => amount(entry.cashSales)))
      };
    }),
    vendorPurchases: [...vendors].map(name => ({
      name,
      amount: sum(purchases.map(purchase => amount(purchase.vendorAmounts?.[name])))
    })).filter(item => item.amount > 0)
  };
}

export async function getYearlyDashboard(year: number): Promise<YearlyDashboard> {
  const months = [];
  for (let month = 1; month <= 12; month++) {
    const data = await getMonthlyDashboard(year, month);
    months.push({
      month,
      label: MONTHS[month - 1],
      totalSales: data.totalSales,
      totalPurchases: data.totalPurchases,
      totalExpenses: data.totalExpenses,
      netAmount: data.netAmount,
      closingBalance: data.totalBalance
    });
  }
  const totalSales = sum(months.map(item => item.totalSales));
  const totalPurchases = sum(months.map(item => item.totalPurchases));
  const totalExpenses = sum(months.map(item => item.totalExpenses));
  return {
    year,
    totalSales,
    totalPurchases,
    totalExpenses,
    netAmount: totalSales - totalPurchases - totalExpenses,
    closingBalance: months.at(-1)?.closingBalance || 0,
    months
  };
}

export async function getViewerYearlyDashboard(year: number): Promise<ViewerYearlyDashboard> {
  const months = [];
  for (let month = 1; month <= 12; month++) {
    const data = await getViewerMonthlyDashboard(year, month);
    months.push({
      month,
      label: MONTHS[month - 1],
      totalSales: data.totalSales,
      totalPurchases: data.totalPurchases,
      salesAfterPurchases: data.salesAfterPurchases
    });
  }
  const totalSales = sum(months.map(item => item.totalSales));
  const totalPurchases = sum(months.map(item => item.totalPurchases));
  return { year, totalSales, totalPurchases, salesAfterPurchases: totalSales - totalPurchases, months };
}
