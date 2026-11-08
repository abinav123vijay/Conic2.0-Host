'use client';

import '../dashboard-highlights.css';
import './monthly.css';
import { useEffect, useState } from 'react';
import { BarChart, DonutChart, KPI, LineChart, StackedMetricChart } from '@/components/Charts';
import { MonthYear } from '@/components/Controls';
import type { MonthlyDashboard, ViewerMonthlyDashboard } from '@/types/domain';

const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value || 0);

export default function MonthlyPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [isOwner, setIsOwner] = useState<boolean | null>(null);
  const [ownerData, setOwnerData] = useState<MonthlyDashboard | null>(null);
  const [viewerData, setViewerData] = useState<ViewerMonthlyDashboard | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/auth/me').then(async response => {
      if (!response.ok) throw new Error('Unable to verify your account permissions.');
      const user = await response.json();
      setIsOwner(user.role === 'owner');
    }).catch(reason => setError(reason instanceof Error ? reason.message : 'Unable to verify your account permissions.'));
  }, []);

  useEffect(() => {
    if (isOwner === null) return;
    const controller = new AbortController();
    setOwnerData(null);
    setViewerData(null);
    setError('');
    fetch(`/api/dashboard/monthly?year=${year}&month=${month}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not load the monthly dashboard.');
        return result as MonthlyDashboard | ViewerMonthlyDashboard;
      })
      .then(result => {
        if (isOwner) setOwnerData(result as MonthlyDashboard);
        else setViewerData(result as ViewerMonthlyDashboard);
      })
      .catch(reason => {
        if (reason instanceof Error && reason.name !== 'AbortError') setError(reason.message);
      });
    return () => controller.abort();
  }, [year, month, isOwner]);

  if (error) return <section className="content"><p role="alert">{error}</p></section>;
  if (isOwner === null || (isOwner ? !ownerData : !viewerData)) return <div className="loading">Loading dashboard…</div>;
  const period = new Date(year, month - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  if (!isOwner && viewerData) {
    return <section className="content">
      <div className="page-head"><div><h1>Monthly Dashboard</h1><p>Approved sales and vendor purchases for {period}.</p></div><MonthYear year={year} month={month} onChange={(nextYear, nextMonth) => { setYear(nextYear); setMonth(nextMonth); }} /></div>
      {viewerData.totalSales === 0 && viewerData.totalPurchases === 0 && <div className="dashboard-empty-period" role="status">No approved activity recorded for {period}.</div>}
      <div className="grid kpi-grid">
        <KPI title="Total Sales" value={money(viewerData.totalSales)} sub={`Online ${money(viewerData.onlineSales)} · Cash ${money(viewerData.cashSales)}`} />
        <KPI title="Approved Vendor Purchases" value={money(viewerData.totalPurchases)} />
        <KPI title="Sales After Approved Purchases" value={money(viewerData.salesAfterPurchases)} sub="Excludes salary, rent, and other private costs" />
      </div>
      <div className="grid chart-grid">
        <LineChart title="Daily Sales Trend" data={viewerData.daily.map(item => ({ label: item.label, value: item.sales }))} />
        <DonutChart title="Online vs Cash Sales" segments={[{ label: 'Online', value: viewerData.onlineSales }, { label: 'Cash', value: viewerData.cashSales }]} />
        <BarChart title="Approved Vendor Purchases" data={viewerData.vendorPurchases.map(item => ({ label: item.name, value: item.amount }))} />
        <StackedMetricChart title="Daily Sales" data={viewerData.daily.map(item => ({ label: item.label, sales: item.sales, purchases: 0, expenses: 0 }))} />
      </div>
    </section>;
  }

  const data = ownerData!;
  return <section className="content">
    <div className="page-head"><div><h1>Monthly Dashboard</h1><p>Operating result uses recorded sales, purchases, daily costs, and rent for {period}. Partner distributions are excluded.</p></div><MonthYear year={year} month={month} onChange={(nextYear, nextMonth) => { setYear(nextYear); setMonth(nextMonth); }} /></div>
    {data.totalSales === 0 && data.totalPurchases === 0 && data.totalExpenses === 0 && <div className="dashboard-empty-period" role="status">No activity recorded for {period}.</div>}
    <div className="grid kpi-grid">
      <KPI title="Total Sales" value={money(data.totalSales)} sub={`Online ${money(data.onlineSales)} · Cash ${money(data.cashSales)}`} />
      <KPI title="Total Purchases" value={money(data.totalPurchases)} />
      <KPI title="Daily Salary" value={money(data.dailySalary)} />
      <KPI title="Other Daily Expenses" value={money(data.dailyOperatingExpenses)} />
      <KPI title="Recorded Rent" value={money(data.rent)} />
      <KPI title="Monthly Operating Result" value={money(data.netAmount)} sub="Does not imply approval for partner distribution" />
      <KPI title="Recorded Balance" value={money(data.totalBalance)} />
    </div>
    <div className="grid chart-grid">
      <LineChart title="Daily Sales Trend" data={data.daily.map(item => ({ label: item.label, value: item.sales }))} />
      <StackedMetricChart title="Daily Sales vs Expenses" data={data.daily.map(item => ({ label: item.label, sales: item.sales, purchases: 0, expenses: item.expenses }))} />
      <DonutChart title="Online vs Cash Sales" segments={[{ label: 'Online', value: data.onlineSales }, { label: 'Cash', value: data.cashSales }]} />
      <BarChart title="Recorded Expense Categories" data={data.expenseBreakdown.map(item => ({ label: item.name, value: item.amount }))} />
      <BarChart title="Vendor Purchase Share" data={data.vendorPurchases.map(item => ({ label: item.name, value: item.amount }))} />
      <StackedMetricChart title="Operating Summary" data={[{ label: period, sales: data.totalSales, purchases: data.totalPurchases, expenses: data.totalExpenses }]} />
    </div>
  </section>;
}
