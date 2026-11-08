'use client';

import './reconciliation.css';
import { useCallback, useEffect, useState } from 'react';

type Reconciliation = {
  businessId: string;
  date: string;
  bookOnline: number;
  bookCash: number;
  actualOnline: number;
  actualCash: number;
  varianceOnline: number;
  varianceCash: number;
  notes: string;
  reconciledAt: string;
  updatedAt: string;
};

type ReconciliationData = {
  date: string;
  calculated: { online: number; cash: number; total: number };
  saved: Reconciliation | null;
  history: Reconciliation[];
};

const money = (value: number) => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2
}).format(value || 0);

function localISODate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function ReconciliationPage() {
  const [date, setDate] = useState(() => localISODate(new Date()));
  const [data, setData] = useState<ReconciliationData | null>(null);
  const [actualOnline, setActualOnline] = useState('');
  const [actualCash, setActualCash] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async (selectedDate: string) => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/reconciliation?date=${encodeURIComponent(selectedDate)}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load account reconciliation.');
      const nextData = result as ReconciliationData;
      setData(nextData);
      setActualOnline(nextData.saved ? String(nextData.saved.actualOnline) : '');
      setActualCash(nextData.saved ? String(nextData.saved.actualCash) : '');
      setNotes(nextData.saved?.notes || '');
    } catch (loadError) {
      setData(null);
      setError(loadError instanceof Error ? loadError.message : 'Could not load account reconciliation.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(date);
  }, [date, load]);

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/reconciliation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, actualOnline: Number(actualOnline), actualCash: Number(actualCash), notes })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save reconciliation.');
      await load(date);
      setMessage('Reconciliation saved.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save reconciliation.');
    } finally {
      setSaving(false);
    }
  };

  const varianceOnline = data && actualOnline !== '' ? Number(actualOnline) - data.calculated.online : null;
  const varianceCash = data && actualCash !== '' ? Number(actualCash) - data.calculated.cash : null;
  const hasVariance = (varianceOnline !== null && varianceOnline !== 0) || (varianceCash !== null && varianceCash !== 0);
  const complete = varianceOnline !== null && varianceCash !== null;

  return <section className="content">
    <div className="page-head">
      <div>
        <h1>Account Reconciliation</h1>
        <p>Compare your verified bank/online and cash-in-hand balances with the recorded balance for a chosen date.</p>
      </div>
    </div>

    <form className="card form-card reconciliation-form" onSubmit={save}>
      <div className="form-grid">
        <label>Balance as of<input type="date" value={date} onChange={event => setDate(event.target.value)} required /></label>
        <label>Actual online / bank balance<input type="number" min="0" step="0.01" value={actualOnline} onChange={event => setActualOnline(event.target.value)} required /></label>
        <label>Actual cash in hand<input type="number" min="0" step="0.01" value={actualCash} onChange={event => setActualCash(event.target.value)} required /></label>
        <label className="wide">Notes (optional)<input maxLength={500} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Statement reference or explanation for a difference" /></label>
      </div>
      {error && <p className="reconciliation-error" role="alert">{error}</p>}
      {message && <p className="status" role="status">{message}</p>}
      <div className="form-actions"><button type="submit" disabled={saving || loading}>{saving ? 'Saving...' : data?.saved ? 'Update Reconciliation' : 'Save Reconciliation'}</button></div>
    </form>

    {loading && <div className="loading">Calculating balances…</div>}
    {!loading && data && <div className="grid reconciliation-grid">
      <section className="card table-card" aria-labelledby="comparison-title">
        <h2 className="card-title" id="comparison-title">Balance comparison for {date}</h2>
        <div className="table-wrap">
          <table className="reconciliation-table">
            <thead><tr><th>Account</th><th>Recorded balance</th><th>Verified balance</th><th>Difference</th></tr></thead>
            <tbody>
              <tr><td>Online / bank</td><td>{money(data.calculated.online)}</td><td>{actualOnline === '' ? '—' : money(Number(actualOnline))}</td><td className={varianceOnline ? 'negative' : ''}>{varianceOnline === null ? '—' : money(varianceOnline)}</td></tr>
              <tr><td>Cash in hand</td><td>{money(data.calculated.cash)}</td><td>{actualCash === '' ? '—' : money(Number(actualCash))}</td><td className={varianceCash ? 'negative' : ''}>{varianceCash === null ? '—' : money(varianceCash)}</td></tr>
              <tr className="reconciliation-total"><td>Total</td><td>{money(data.calculated.total)}</td><td>{complete ? money(Number(actualOnline) + Number(actualCash)) : '—'}</td><td>{complete ? money(Number(varianceOnline) + Number(varianceCash)) : '—'}</td></tr>
            </tbody>
          </table>
        </div>
        {!data.saved && <p className="reconciliation-warning" role="status">No reconciliation has been saved for {date}. Enter the verified balances and save to clear this date’s warning.</p>}
        {complete && (hasVariance
          ? <p className="reconciliation-warning" role="status">Difference found. Check missing or incorrectly dated sales, purchases, expenses, finance payments, or opening balances before relying on the recorded balance.</p>
          : <p className="reconciliation-match" role="status">Balances match for this date.</p>)}
      </section>

      <section className="card reconciliation-help">
        <h2 className="card-title">What is compared?</h2>
        <p>Recorded balances are recalculated through the selected date using opening balances, online and cash sales, cash/online expenses, purchase payments, finance outflows, and loan repayments.</p>
        <p>Enter the balances you verified from your bank or payment account and your cash count. A positive difference means the verified amount is higher than the recorded amount; a negative difference means it is lower.</p>
      </section>
    </div>}

    {!loading && data && <section className="card table-card reconciliation-history">
      <h2 className="card-title">Saved reconciliation history</h2>
      {data.history.length === 0
        ? <p className="reconciliation-empty">No reconciliations saved yet.</p>
        : <div className="table-wrap"><table>
          <thead><tr><th>Date</th><th>Recorded online</th><th>Verified online</th><th>Online difference</th><th>Recorded cash</th><th>Verified cash</th><th>Cash difference</th></tr></thead>
          <tbody>{data.history.map(item => <tr key={item.date}>
            <td><button type="button" className="reconciliation-date" onClick={() => setDate(item.date)}>{item.date}</button></td>
            <td>{money(item.bookOnline)}</td><td>{money(item.actualOnline)}</td><td className={item.varianceOnline ? 'negative' : ''}>{money(item.varianceOnline)}</td>
            <td>{money(item.bookCash)}</td><td>{money(item.actualCash)}</td><td className={item.varianceCash ? 'negative' : ''}>{money(item.varianceCash)}</td>
          </tr>)}</tbody>
        </table></div>}
    </section>}
  </section>;
}
