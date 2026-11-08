'use client';

import '../finance.css';
import '../finance-options.css';
import { useEffect, useState } from 'react';

type SavingRecord = {
  businessId: string;
  date: string;
  onlineAmount: number;
  cashAmount: number;
  notes: string;
};
type DailySales = { date: string; onlineSales: number; cashSales: number };

const localDate = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
const emptyForm = () => ({ date: localDate(), onlineAmount: 0, cashAmount: 0, notes: '' });
const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value || 0);

export default function DailySavingsPage() {
  const [records, setRecords] = useState<SavingRecord[]>([]);
  const [dailySales, setDailySales] = useState<DailySales[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const response = await fetch('/api/finance/savings', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load daily savings.');
    const result = await response.json();
    setRecords(result.records);
    setDailySales(result.dailySales);
    setForm(current => {
      const existing = result.records.find((record: SavingRecord) => record.date === current.date);
      return existing
        ? { ...current, onlineAmount: existing.onlineAmount, cashAmount: existing.cashAmount, notes: existing.notes }
        : current;
    });
  };
  useEffect(() => { load().catch(reason => setError(reason.message)); }, []);

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/finance/savings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save daily savings.');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save daily savings.');
    } finally {
      setBusy(false);
    }
  };

  const sales = dailySales.find(item => item.date === form.date);
  const savedTotal = records.reduce((total, record) => total + record.onlineAmount + record.cashAmount, 0);

  return <section className="content finance-page">
    <div className="page-head"><div><h1>Daily Savings</h1><p>Set aside part of a day’s recorded online and cash sales. Saved amounts are deducted from the corresponding operating balances.</p></div></div>
    <div className="finance-savings-summary">
      <div className="card"><span>Total savings recorded</span><strong>{money(savedTotal)}</strong></div>
      <div className="card"><span>Selected date sales</span><strong>{money((sales?.onlineSales || 0) + (sales?.cashSales || 0))}</strong></div>
    </div>
    <form className="card form-card" onSubmit={save}>
      <div className="card-title">Record daily savings</div>
      <div className="form-grid">
        <label>Date<input type="date" required value={form.date} onChange={event => {
          const date = event.target.value;
          const existing = records.find(record => record.date === date);
          setForm({ date, onlineAmount: existing?.onlineAmount || 0, cashAmount: existing?.cashAmount || 0, notes: existing?.notes || '' });
        }} /></label>
        <label>Online savings<input type="number" min="0" max={sales?.onlineSales || 0} step="0.01" required value={form.onlineAmount} onChange={event => setForm({ ...form, onlineAmount: Number(event.target.value) })} /></label>
        <label>Cash savings<input type="number" min="0" max={sales?.cashSales || 0} step="0.01" required value={form.cashAmount} onChange={event => setForm({ ...form, cashAmount: Number(event.target.value) })} /></label>
        <label className="wide">Notes<input maxLength={300} value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} /></label>
      </div>
      <p>Available for savings on this date: online {money(sales?.onlineSales || 0)} · cash {money(sales?.cashSales || 0)}. Record the day’s sales in Daily Entries first.</p>
      {error && <p className="finance-error" role="alert">{error}</p>}
      <div className="form-actions"><button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save daily savings'}</button></div>
    </form>
    <div className="card table-card"><div className="card-title">Savings history</div><div className="table-wrap">
      <table><thead><tr><th>Date</th><th>Online savings</th><th>Cash savings</th><th>Total</th><th>Notes</th></tr></thead>
        <tbody>{records.map(record => <tr key={record.date}><td>{record.date}</td><td>{money(record.onlineAmount)}</td><td>{money(record.cashAmount)}</td><td>{money(record.onlineAmount + record.cashAmount)}</td><td>{record.notes || '—'}</td></tr>)}
          {records.length === 0 && <tr><td colSpan={5}>No daily savings have been recorded.</td></tr>}
        </tbody>
      </table>
    </div></div>
  </section>;
}
