'use client';

import '../dashboard-highlights.css';
import { useEffect, useState } from 'react';
import { KPI, LineChart, StackedMetricChart } from '@/components/Charts';
import { MonthYear } from '@/components/Controls';
import type { ViewerYearlyDashboard, YearlyDashboard } from '@/types/domain';

const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value || 0);

export default function YearlyPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [isOwner, setIsOwner] = useState<boolean | null>(null);
  const [ownerData, setOwnerData] = useState<YearlyDashboard | null>(null);
  const [viewerData, setViewerData] = useState<ViewerYearlyDashboard | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/auth/me').then(async response => {
      if (!response.ok) throw new Error('Unable to verify your account permissions.');
      setIsOwner((await response.json()).role === 'owner');
    }).catch(reason => setError(reason instanceof Error ? reason.message : 'Unable to verify account permissions.'));
  }, []);

  useEffect(() => {
    if (isOwner === null) return;
    const controller = new AbortController();
    setOwnerData(null);
    setViewerData(null);
    fetch(`/api/dashboard/yearly?year=${year}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not load the yearly dashboard.');
        return result as YearlyDashboard | ViewerYearlyDashboard;
      })
      .then(result => {
        if (isOwner) setOwnerData(result as YearlyDashboard);
        else setViewerData(result as ViewerYearlyDashboard);
      })
      .catch(reason => {
        if (reason instanceof Error && reason.name !== 'AbortError') setError(reason.message);
      });
    return () => controller.abort();
  }, [year, isOwner]);

  if (error) return <section className="content"><p role="alert">{error}</p></section>;
  if (isOwner === null || (isOwner ? !ownerData : !viewerData)) return <div className="loading">Loading yearly dashboard…</div>;

  if (!isOwner && viewerData) return <section className="content">
    <div className="page-head"><div><h1>Yearly Dashboard</h1><p>Approved sales and vendor purchases for {year}.</p></div><MonthYear year={year} month={month} onChange={(nextYear, nextMonth) => { setYear(nextYear); setMonth(nextMonth); }} /></div>
    <div className="grid kpi-grid">
      <KPI title="Annual Sales" value={money(viewerData.totalSales)} />
      <KPI title="Approved Vendor Purchases" value={money(viewerData.totalPurchases)} />
      <KPI title="Sales After Approved Purchases" value={money(viewerData.salesAfterPurchases)} sub="Excludes salary, rent, and other private costs" />
    </div>
    <div className="grid chart-grid">
      <StackedMetricChart title={`Monthly Sales and Approved Purchases · ${year}`} data={viewerData.months.map(item => ({ label: item.label.slice(0, 3), sales: item.totalSales, purchases: item.totalPurchases, expenses: 0 }))} />
      <LineChart title="Monthly Sales After Approved Purchases" data={viewerData.months.map(item => ({ label: item.label.slice(0, 3), value: item.salesAfterPurchases }))} />
    </div>
    <div className="card table-card"><div className="card-title">January–December Summary</div><div className="table-wrap">
      <table><thead><tr><th>Month</th><th>Sales</th><th>Approved vendor purchases</th><th>Sales after purchases</th></tr></thead>
        <tbody>{viewerData.months.map(item => <tr key={item.month}><td>{item.label}</td><td>{money(item.totalSales)}</td><td>{money(item.totalPurchases)}</td><td>{money(item.salesAfterPurchases)}</td></tr>)}</tbody>
      </table>
    </div></div>
  </section>;

  const data = ownerData!;
  const hasActivity = data.totalSales > 0 || data.totalPurchases > 0 || data.totalExpenses > 0;
  return <section className="content">
    <div className="page-head"><div><h1>Yearly Dashboard</h1><p>Monthly operating performance for {year}. Selected month: <strong>{data.months[month - 1]?.label}</strong>.</p></div><MonthYear year={year} month={month} onChange={(nextYear, nextMonth) => { setYear(nextYear); setMonth(nextMonth); }} /></div>
    {!hasActivity && <div className="dashboard-empty-period" role="status">No activity recorded for {year}.</div>}
    <div className="grid kpi-grid">
      <KPI title="Annual Sales" value={money(data.totalSales)} />
      <KPI title="Annual Purchases" value={money(data.totalPurchases)} />
      <KPI title="Annual Recorded Expenses" value={money(data.totalExpenses)} />
      <KPI title="Annual Operating Result" value={money(data.netAmount)} />
      <KPI title="Year-end Balance" value={money(data.closingBalance)} />
    </div>
    <div className="grid chart-grid">
      <StackedMetricChart title={`Monthly Operating Summary · ${year}`} data={data.months.map(item => ({ label: item.label.slice(0, 3), sales: item.totalSales, purchases: item.totalPurchases, expenses: item.totalExpenses }))} />
      <LineChart title="Monthly Operating Result" data={data.months.map(item => ({ label: item.label.slice(0, 3), value: item.netAmount }))} />
      <LineChart title="Closing Balance Trend" data={data.months.map(item => ({ label: item.label.slice(0, 3), value: item.closingBalance }))} />
    </div>
    <div className="card table-card"><div className="card-title">January–December Summary</div><div className="table-wrap">
      <table><thead><tr><th>Month</th><th>Sales</th><th>Purchases</th><th>Recorded expenses</th><th>Operating result</th><th>Closing balance</th></tr></thead>
        <tbody>{data.months.map(item => <tr key={item.month}><td>{item.label}</td><td>{money(item.totalSales)}</td><td>{money(item.totalPurchases)}</td><td>{money(item.totalExpenses)}</td><td>{money(item.netAmount)}</td><td>{money(item.closingBalance)}</td></tr>)}</tbody>
      </table>
    </div></div>
  </section>;
}
