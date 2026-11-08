'use client';

import '../finance.css';
import { useEffect, useState } from 'react';

type RentRecord = { businessId: string; period: string; amount: number; paymentDate: string; status: 'paid' | 'pending'; notes: string };
const currentPeriod = () => new Date().toISOString().slice(0, 7);
const emptyRecord = (): RentRecord => ({ businessId: '', period: currentPeriod(), amount: 0, paymentDate: `${currentPeriod()}-01`, status: 'pending', notes: '' });
const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value || 0);

export default function RentPage() {
  const [records, setRecords] = useState<RentRecord[]>([]);
  const [form, setForm] = useState<RentRecord>(emptyRecord);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const response = await fetch('/api/finance/rent', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load rent history.');
    setRecords(await response.json());
  };
  useEffect(() => { load().catch(reason => setError(reason.message)); }, []);

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/finance/rent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save rent.');
      await load();
      setForm(emptyRecord());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save rent.');
    } finally {
      setBusy(false);
    }
  };

  return <section className="content">
    <div className="page-head"><div><h1>Rent Management</h1><p>Rent is optional. No amount is assumed until an owner records the confirmed figure.</p></div></div>
    <form className="card form-card" onSubmit={save}>
      <div className="form-grid">
        <label>Month<input type="month" required value={form.period} onChange={event => {
          const period = event.target.value;
          setForm(current => ({ ...current, period, paymentDate: period ? `${period}-01` : '' }));
        }} /></label>
        <label>Rent amount<input type="number" min="0.01" step="0.01" required value={form.amount || ''} onChange={event => setForm({ ...form, amount: Number(event.target.value) })} /></label>
        <label>Payment date<input type="date" required value={form.paymentDate} onChange={event => setForm({ ...form, paymentDate: event.target.value })} /></label>
        <label>Status<select value={form.status} onChange={event => setForm({ ...form, status: event.target.value as RentRecord['status'] })}><option value="pending">Pending</option><option value="paid">Paid</option></select></label>
        <label className="wide">Notes<input maxLength={500} value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} /></label>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="form-actions"><button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save monthly rent'}</button></div>
    </form>
    <div className="card table-card"><div className="card-title">Monthly rent history</div><div className="table-wrap">
      <table><thead><tr><th>Month</th><th>Amount</th><th>Payment date</th><th>Status</th><th>Notes</th></tr></thead>
        <tbody>{records.map(record => <tr key={record.period}><td>{record.period}</td><td>{money(record.amount)}</td><td>{record.paymentDate}</td><td>{record.status}</td><td>{record.notes || '—'}</td></tr>)}
          {records.length === 0 && <tr><td colSpan={5}>No rent has been recorded.</td></tr>}
        </tbody>
      </table>
    </div></div>
  </section>;
}
