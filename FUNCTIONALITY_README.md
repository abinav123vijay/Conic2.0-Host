# CONIC Truck 2 Functionality

This guide describes the independent Truck 2 copy. Application configuration is fixed to database and business ID `conic_truck2`; the server rejects a different `MONGODB_DB` or `CONIC_BUSINESS_ID`. No client-provided business ID is used for database queries.

## Request and authorization flow

Protected requests pass through [proxy.ts](./proxy.ts) and are also authorized in the relevant API handler via [lib/authz.ts](./lib/authz.ts). Sessions are signed and verified in [lib/auth.ts](./lib/auth.ts). Only `owner` and `viewer` roles are valid. Authenticated account records and operational records are scoped to the configured Truck 2 business ID.

The API policy is:

| Operation | Owner | Viewer |
| --- | --- | --- |
| Overview/monthly/yearly dashboards | Full | Safe sales and approved purchase aggregates |
| Daily and purchase reads | Full records | Safe read-only DTOs |
| Daily/purchase writes | Allowed | `403` |
| Rent and partner distribution APIs | Allowed | `403` |
| Balance, reconciliation, settings, Excel | Allowed | `403` |

The viewer DTOs omit sensitive fields entirely; the UI is not the security boundary. Viewer monthly/yearly calculations query sales and configured vendor purchases and do not request balances or expose salary, expenses, rent, partner records, payment statuses, or reconciliation information.

## Daily Entries and dashboards

`/api/daily` reads from `dailyEntries`; the form at `/entries/daily` is owner-only. Daily salary and operational expenses remain part of the existing daily expense map. Monthly calculations include them once and do not read a second Finance salary source.

`/api/purchases` reads `purchaseEntries`. Viewer records include purchase date and only the vendor amounts from the configured vendor list, excluding `Other` and `Transport`; viewer aggregates are based on those approved vendors only.

Owner monthly operating result is total sales minus total purchases, daily salary, other recorded daily expenses, and recorded rent. A missing rent record contributes zero. Partner distributions are not operating costs. Viewer dashboards instead show sales, approved vendor purchases, and sales after those purchases; this is explicitly not profit.

## Finance data

- `rentPayments`: at most one monthly record using a deterministic `_id` and `{businessId, period}`. No record means no assumed rent.
- `partnerDistributions`: one monthly owner-approved distribution, with a 40% friend allocation and 60% investor-pool allocation. If entered, investor split percentages apply to the pool and must total 100%. Payments may be partial, cannot exceed an allocation, and identical recipient/amount/date entries are rejected atomically.

Finance navigation contains only Rent and Partner Payments. There are no loan, EMI, interest, savings, or duplicate salary/expense interfaces or APIs. Existing unrelated legacy collections are neither migrated nor deleted.

## Excel and data safety

Excel import/export APIs are owner-only. Export reads only the configured business and includes operational data, rent, partner distributions, and optional reconciliation—not loan or EMI records. Import replaces only the configured Truck 2 business settings, daily entries, and purchases after explicit UI confirmation; it does not write finance or user collections.

Do not run a seed script, connect to Truck 1, deploy to Truck 1, or run database initialization without first reviewing its effects and confirming the Truck 2 Atlas organization and database.

## MongoDB and deployment

`lib/mongodb.ts` connects only to `MONGODB_URI` and refuses a database name other than `conic_truck2`. `MONGODB_URI` has no fallback. Use a Truck 2 Atlas URI from the application's own Atlas organization and preferably a database user restricted to read/write access on `conic_truck2`. No credentials belong in source control.

Render should use a new Web Service, service-specific environment variables, and `/api/health`. Keep Truck 1's Render service, environment, deployment triggers, and production branch untouched.
