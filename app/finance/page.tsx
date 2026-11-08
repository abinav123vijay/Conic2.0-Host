import type { Route } from 'next';
import Link from 'next/link';
import './finance.css';
import './finance-options.css';

export default function FinancePage() {
  return <section className="content finance-page">
    <div className="page-head"><div><h1>Finance</h1><p>Manage rent, partner payouts, and daily savings.</p></div></div>
    <div className="finance-options">
      <Link className="card finance-option" href={'/finance/rent' as Route}>
        <h2>Rent</h2><p>Record monthly rent and payment status.</p>
      </Link>
      <Link className="card finance-option" href={'/finance/partner-payments' as Route}>
        <h2>Partner Payments</h2><p>Approve distributions and record payouts.</p>
      </Link>
      <Link className="card finance-option" href={'/finance/savings' as Route}>
        <h2>Daily Savings</h2><p>Set aside online and cash sales by day.</p>
      </Link>
    </div>
  </section>;
}
