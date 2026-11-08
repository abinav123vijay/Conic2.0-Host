# CONIC functional parity map

| Existing workbook / HTML | Next.js implementation |
|---|---|
| Monthly Dashboard | `/dashboard/monthly` |
| Yearly Dashboard | `/dashboard/yearly` |
| Daily Sales & Expenses | `/entries/daily` + `/api/daily` |
| Weekly Purchases | `/entries/purchases` + `/api/purchases` |
| Settings | `/settings` + `/api/settings` |
| Online/Cash balance carry-forward | `lib/dashboard/metrics.ts` |
| Vendor totals | `vendorAmounts` map + monthly aggregation |
| Expense categories | editable `expenseCategories` array |
| Pending purchases | derived from purchase total minus paid amounts |
| Monthly analytics charts | responsive React/SVG chart components |
| Yearly trend charts | responsive React/SVG chart components |
| Excel → dashboard | `/api/excel/import` |
| Dashboard → Excel | `/api/excel/export` using the current CONIC template |
| Multi-device source of truth | MongoDB Atlas |

## Important data rule

Dashboard totals are derived from transaction documents. A total stored in a dashboard card is never treated as the authoritative financial record. This prevents stale dashboard values after edits.
