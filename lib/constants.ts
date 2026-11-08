export const BUSINESS_ID = process.env.CONIC_BUSINESS_ID || 'conic_truck2';
if (BUSINESS_ID !== 'conic_truck2') throw new Error('CONIC_BUSINESS_ID must be conic_truck2 for this application.');
export const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
export const DEFAULT_VENDORS = ['RawDawg','Fetch','Nord','Belucci','FoolHardy','Core','Dexer','Nordich','Never','Ozaro'];
export const DEFAULT_EXPENSE_CATEGORIES = ['Police','Shop','Transport','Other'];

export const inr = (value: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value || 0);

export function isoMonthStart(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

export function isoMonthEnd(year: number, month: number) {
  const d = new Date(Date.UTC(year, month, 0));
  return d.toISOString().slice(0, 10);
}
