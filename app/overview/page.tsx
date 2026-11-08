'use client';

import './overview.css';
import '../dashboard/dashboard-highlights.css';
import { useEffect, useState } from 'react';
import { BarChart, DonutChart, KPI, LineChart, StackedMetricChart } from '@/components/Charts';
import { MonthYear } from '@/components/Controls';
import type { MonthlyDashboard, ViewerMonthlyDashboard, ViewerYearlyDashboard, YearlyDashboard } from '@/types/domain';

const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value || 0);

export default function OverviewPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [isOwner, setIsOwner] = useState<boolean | null>(null);
  const [monthly, setMonthly] = useState<MonthlyDashboard | ViewerMonthlyDashboard | null>(null);
  const [yearly, setYearly] = useState<YearlyDashboard | ViewerYearlyDashboard | null>(null);
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
    setMonthly(null);
    setYearly(null);
    setError('');
    Promise.all([
      fetch(`/api/dashboard/monthly?year=${year}&month=${month}`, { signal: controller.signal, cache: 'no-store' }),
      fetch(`/api/dashboard/yearly?year=${year}`, { signal: controller.signal, cache: 'no-store' })
    ]).then(async ([monthlyResponse, yearlyResponse]) => {
      const [monthlyResult, yearlyResult] = await Promise.all([monthlyResponse.json(), yearlyResponse.json()]);
      if (!monthlyResponse.ok || !yearlyResponse.ok) throw new Error(monthlyResult.error || yearlyResult.error || 'Unable to load overview data.');
      return [monthlyResult, yearlyResult] as const;
    }).then(([monthlyResult, yearlyResult]) => {
      setMonthly(monthlyResult as MonthlyDashboard | ViewerMonthlyDashboard);
      setYearly(yearlyResult as YearlyDashboard | ViewerYearlyDashboard);
    }).catch(reason => {
      if (reason instanceof Error && reason.name !== 'AbortError') setError(reason.message);
    });
    return () => controller.abort();
  }, [year, month, isOwner]);

  if (error) return <section className="content"><p role="alert">{error}</p></section>;
  if (isOwner === null || !monthly || !yearly) return <div className="loading">Loading overview…</div>;
  const period = new Date(year, month - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  if (!isOwner) {
    const safeMonthly = monthly as ViewerMonthlyDashboard;
    const safeYearly = yearly as ViewerYearlyDashboard;
    return <section className="content">
      <div className="page-head"><div><h1>Overview</h1><p>Approved business performance for {period}.</p></div><MonthYear year={year} month={month} onChange={(nextYear, nextMonth) => { setYear(nextYear); setMonth(nextMonth); }} /></div>
      <div className="grid kpi-grid">
        <KPI title="Monthly Sales" value={money(safeMonthly.totalSales)} />
        <KPI title="Approved Vendor Purchases" value={money(safeMonthly.totalPurchases)} />
        <KPI title="Sales After Approved Purchases" value={money(safeMonthly.salesAfterPurchases)} sub="Excludes salary, rent, and other private costs" />
      </div>
      <div className="grid chart-grid">
        <DonutChart title="Sales Mix" segments={[{ label: 'Online Sales', value: safeMonthly.onlineSales }, { label: 'Cash Sales', value: safeMonthly.cashSales }]} />
        <LineChart title="Daily Sales Trend" data={safeMonthly.daily.map(item => ({ label: item.label, value: item.sales }))} />
        <StackedMetricChart title={`Monthly Sales and Approved Purchases · ${year}`} data={safeYearly.months.map(item => ({ label: item.label.slice(0, 3), sales: item.totalSales, purchases: item.totalPurchases, expenses: 0 }))} />
        <BarChart title="Approved Vendor Purchases" data={safeMonthly.vendorPurchases.map(item => ({ label: item.name, value: item.amount }))} />
      </div>
    </section>;
  }

  const data = monthly as MonthlyDashboard;
  const ownerYearly = yearly as YearlyDashboard;
  return <section className="content">
    <div className="page-head"><div><h1>Overview</h1><p>Recorded business performance for {period}. Distributions require separate owner approval.</p></div><MonthYear year={year} month={month} onChange={(nextYear, nextMonth) => { setYear(nextYear); setMonth(nextMonth); }} /></div>
    <div className="grid kpi-grid">
      <KPI title="Monthly Sales" value={money(data.totalSales)} sub={`Online ${money(data.onlineSales)} · Cash ${money(data.cashSales)}`} />
      <KPI title="Monthly Purchases" value={money(data.totalPurchases)} />
      <KPI title="Daily Salary" value={money(data.dailySalary)} />
      <KPI title="Other Daily Expenses" value={money(data.dailyOperatingExpenses)} />
      <KPI title="Recorded Rent" value={money(data.rent)} />
      <KPI title="Monthly Operating Result" value={money(data.netAmount)} />
      <KPI title="Recorded Balance" value={money(data.totalBalance)} />
    </div>
    <div className="grid chart-grid">
      <DonutChart title="Sales Mix" segments={[{ label: 'Online Sales', value: data.onlineSales }, { label: 'Cash Sales', value: data.cashSales }]} />
      <LineChart title="Daily Sales Trend" data={data.daily.map(item => ({ label: item.label, value: item.sales }))} />
      <StackedMetricChart title={`Monthly Operating Summary · ${year}`} data={ownerYearly.months.map(item => ({ label: item.label.slice(0, 3), sales: item.totalSales, purchases: item.totalPurchases, expenses: item.totalExpenses }))} />
      <BarChart title="Recorded Expense Categories" data={data.expenseBreakdown.map(item => ({ label: item.name, value: item.amount }))} />
      <BarChart title="Vendor Purchase Mix" data={data.vendorPurchases.map(item => ({ label: item.name, value: item.amount }))} />
    </div>
  </section>;
}
