# CONIC Truck 2

Independent Next.js application for the second CONIC clothing truck. This copy uses its own MongoDB Atlas organization, database, business identifier, session secret, invite codes, and Render service. It must not be pointed at Truck 1.

## Application

- Next.js 16 App Router, React, TypeScript, and MongoDB Node.js driver.
- MongoDB database: `conic_truck2`; business ID: `conic_truck2`.
- Existing Atlas database and `users` collection are reused. The app creates its operational collections through normal writes; do not run a seed or migrate Truck 1 data.
- Health check: `GET /api/health`.
- Pages: Overview, Monthly Dashboard, Yearly Dashboard, Daily Entries, Purchases, Finance, Settings, Reconciliation, and Excel Import/Export.

## Roles and business structure

There are exactly two application roles:

| Account | Role | Access |
| --- | --- | --- |
| Application manager | Owner | Full access |
| Friend (40% shareholder) | Owner | Full access |
| Investor 1 | Viewer | Read-only, safe operational dashboards |
| Investor 2 | Viewer | Read-only, safe operational dashboards |

Share percentages do not affect application roles. Signup uses server-side `AUTH_OWNER_SIGNUP_CODE` and `AUTH_VIEWER_SIGNUP_CODE`; the request cannot choose a role. Signup permits at most two accounts per role. No default account or password is created.

Owners can access all pages and write APIs. Viewers can access Overview, Monthly Dashboard, Yearly Dashboard, Daily Entries, and Purchases. Viewer API responses contain only approved sales and vendor-purchase fields; salary, expenses, rent, partner payments, balance movements, reconciliation, settings, and export data are not returned. Writes and private finance APIs return `403` for viewers.

Passwords use salted scrypt hashes. Session tokens are HMAC-signed and stored in HTTP-only, SameSite=Lax cookies; production cookies are Secure. Set a random, Truck-2-only `AUTH_SESSION_SECRET` with at least 32 characters. It is never derived from the MongoDB URI.

## Daily operations and dashboards

Daily Entries remains the source of truth for sales, salary, and operational expenses. Monthly salary/expense records are not created in Finance and dashboard metrics count daily salary and expenses only once.

Owner monthly operating result:

```text
Sales - Purchases - Daily Salary - Other Recorded Daily Expenses - Recorded Rent
```

An unrecorded rent is zero. Partner distributions are excluded from operating expenses and require separate explicit owner approval. Viewer dashboards show sales, approved vendor purchases, and sales after those purchases—not a profit figure—and do not request balance data.

## Finance

Finance contains only:

- **Rent:** optional amount, date, paid/pending status, notes, and monthly history. No amount is prefilled or generated.
- **Partner Payments:** monthly owner-approved amount, 40% friend / 60% collective investor allocation, optional investor split (must total 100% of the investor pool), payment dates, status, and partial payments. An individual investor split is not assumed. Duplicate identical payment entries and payments above an approved allocation are rejected.
- **Daily Savings:** owners can set aside recorded online and cash sales by date. Savings cannot exceed that day's sales for either account and reduce the corresponding operating balance. Viewers cannot access Finance or its APIs.

Truck 2 has no loan, EMI, interest, or separate salary-management features.

## MongoDB Atlas setup

1. In your own Atlas organization, verify the existing database user has read/write privileges limited to `conic_truck2`. In Atlas, inspect **Database Access → Database User → Built-in Role / Custom Roles** and verify `readWrite` (or equivalent required read/write privileges) is scoped to the `conic_truck2` database.
2. If the user has broader database or cluster-wide access, any credential leak could expose other databases available to that user. Prefer a database-restricted user. Do not change the existing user's password or roles as part of this code setup.
3. Configure `MONGODB_URI` with the connection string from your own organization and `MONGODB_DB=conic_truck2`. Never use Truck 1's URI. Do not run `npm run db:init` unless you have reviewed its validator/index changes and confirmed the selected Atlas organization and database; initialization is not required for normal application writes.

## Local setup

1. Inspect any existing `.env.local` before changing it. Keep real environment files out of Git; only `.env.example` is tracked.
2. Copy `.env.example` to `.env.local` and fill in the Truck 2 connection string and unique secrets:

```env
MONGODB_URI=
MONGODB_DB=conic_truck2
CONIC_BUSINESS_ID=conic_truck2
AUTH_SESSION_SECRET=
AUTH_OWNER_SIGNUP_CODE=
AUTH_VIEWER_SIGNUP_CODE=
NODE_ENV=development
```

Generate each secret independently, for example with Node's `crypto.randomBytes(32).toString('base64url')`. Do not reuse the session secret as an invite code. Keep the two invite codes different, private, and out of client code.

3. Install dependencies with `npm install`, then start with `npm run dev`.
4. Create two owner accounts using the owner code, then two investor accounts using the viewer code. Signup stops after two accounts of each role. Use separate email addresses and unique passwords of at least 12 characters. Store credentials in a password manager.
5. Test viewer restrictions and owner access locally before deployment.

The existing database and `users` collection are not recreated. Do not run any seed script or import Truck 1 data. The `auth:set-password` script is for a known, existing Truck 2 account only and requires Truck 2 environment values.

## Excel

Owner-only Excel export includes Settings, Daily Sales & Expenses, Weekly Purchases, Rent, Partner Payments, and (when requested) Reconciliation. Loan and EMI data are not included. Import validates the operational workbook, then replaces Truck 2 settings, daily entries, and purchases only; it does not change accounts, rent, partner distributions, or reconciliation records. The UI requires explicit confirmation before an import.

## Tests and checks

```powershell
npm run typecheck
npm test
npm run lint
npm run build
```

Tests use in-memory MongoDB mocks and local HTTP servers; they must not use a production Atlas URI. Configure Truck 2 credentials before trying a database-backed health check.

## Independent Render deployment

Create a new Render Web Service for Truck 2; do not edit or deploy Truck 1's service. Configure these variables directly in that Render service:

```env
MONGODB_URI=<Truck 2 Atlas connection string>
MONGODB_DB=conic_truck2
CONIC_BUSINESS_ID=conic_truck2
AUTH_SESSION_SECRET=<unique production-only random secret, at least 32 characters>
AUTH_OWNER_SIGNUP_CODE=<unique production-only owner invite code>
AUTH_VIEWER_SIGNUP_CODE=<different production-only viewer invite code>
```

Use the real URI from the Truck 2 Atlas organization; do not copy it from a local file or Truck 1. Generate separate production secrets and invite codes rather than automatically reusing `.env.local`. Do not commit any of these values. Build command: `npm run build`; start command: `npm start`; health path: `/api/health`.

Sharing a Git repository or branch can still couple future commits and deployment triggers. Prefer a separate Truck 2 branch or repository and configure Render to deploy only that ref. No deployment is performed by this project setup.
