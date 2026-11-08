'use client';

import '../finance.css';
import { useEffect, useState } from 'react';

type Recipient = 'friend' | 'investors' | 'investor1' | 'investor2';
type Payment = { recipient: Recipient; amount: number; paymentDate: string; note?: string };
type Distribution = {
  businessId: string;
  period: string;
  approvedAmount: number;
  friendAllocation: number;
  investorAllocation: number;
  investor1Percent?: number;
  investor2Percent?: number;
  payments: Payment[];
  notes: string;
  status: 'paid' | 'pending';
};
const periodNow = () => new Date().toISOString().slice(0, 7);
const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value || 0);

export default function PartnerPaymentsPage() {
  const [records, setRecords] = useState<Distribution[]>([]);
  const [period, setPeriod] = useState(periodNow());
  const [approvedAmount, setApprovedAmount] = useState(0);
  const [investor1Percent, setInvestor1Percent] = useState('');
  const [investor2Percent, setInvestor2Percent] = useState('');
  const [notes, setNotes] = useState('');
  const [recipient, setRecipient] = useState<Recipient>('friend');
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [paymentDate, setPaymentDate] = useState(`${periodNow()}-01`);
  const [paymentNote, setPaymentNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const response = await fetch('/api/finance/partner-payments', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load partner distribution history.');
    setRecords(await response.json());
  };
  useEffect(() => { load().catch(reason => setError(reason.message)); }, []);
  useEffect(() => {
    const record = records.find(item => item.period === period);
    setApprovedAmount(record?.approvedAmount || 0);
    setInvestor1Percent(record?.investor1Percent === undefined ? '' : String(record.investor1Percent));
    setInvestor2Percent(record?.investor2Percent === undefined ? '' : String(record.investor2Percent));
    setNotes(record?.notes || '');
  }, [records, period]);

  const saveApproval = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body: Record<string, unknown> = { period, approvedAmount, notes };
      if (investor1Percent !== '' || investor2Percent !== '') {
        body.investor1Percent = Number(investor1Percent);
        body.investor2Percent = Number(investor2Percent);
      }
      const response = await fetch('/api/finance/partner-payments', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save the approved distribution.');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the approved distribution.');
    } finally {
      setBusy(false);
    }
  };

  const savePayment = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/finance/partner-payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period, recipient, amount: paymentAmount, paymentDate, note: paymentNote })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not record partner payment.');
      await load();
      setPaymentAmount(0);
      setPaymentNote('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not record partner payment.');
    } finally {
      setBusy(false);
    }
  };

  const selected = records.find(record => record.period === period);
  const splitConfigured = investor1Percent !== '' || investor2Percent !== '' || selected?.investor1Percent !== undefined;
  const paymentRecipients: Recipient[] = splitConfigured ? ['friend', 'investor1', 'investor2'] : ['friend', 'investors'];

  return <section className="content">
    <div className="page-head"><div><h1>Partner Payments</h1><p>Approve a monthly distribution explicitly. Operating profit is not distributed automatically; partner payments are not operating expenses.</p></div>
      <label>Month<input type="month" value={period} onChange={event => {
        const nextPeriod = event.target.value;
        setPeriod(nextPeriod);
        setPaymentDate(`${nextPeriod}-01`);
        const existing = records.find(record => record.period === nextPeriod);
        setApprovedAmount(existing?.approvedAmount || 0);
        setInvestor1Percent(existing?.investor1Percent === undefined ? '' : String(existing.investor1Percent));
        setInvestor2Percent(existing?.investor2Percent === undefined ? '' : String(existing.investor2Percent));
        setNotes(existing?.notes || '');
      }} /></label>
    </div>
    {error && <p role="alert">{error}</p>}
    <form className="card form-card" onSubmit={saveApproval}>
      <div className="card-title">Owner approval</div>
      <p>Friend allocation defaults to 40%; investors collectively receive 60%. Individual investor allocations are only set when you enter the agreed split.</p>
      <div className="form-grid">
        <label>Approved distribution amount<input type="number" min="0.01" step="0.01" required value={approvedAmount || ''} onChange={event => setApprovedAmount(Number(event.target.value))} /></label>
        <label>Investor 1 share of investor pool (%)<input type="number" min="0" max="100" step="0.01" placeholder="Leave blank until agreed" value={investor1Percent} onChange={event => {
          const value = event.target.value;
          setInvestor1Percent(value);
          setInvestor2Percent(value === '' ? '' : String(100 - Number(value)));
        }} /></label>
        <label>Investor 2 share of investor pool (%)<input type="number" min="0" max="100" step="0.01" placeholder="Calculated from Investor 1" value={investor2Percent} onChange={event => {
          const value = event.target.value;
          setInvestor2Percent(value);
          setInvestor1Percent(value === '' ? '' : String(100 - Number(value)));
        }} /></label>
        <label className="wide">Approval notes<input maxLength={500} value={notes} onChange={event => setNotes(event.target.value)} /></label>
      </div>
      {selected && <p>Friend: {money(selected.friendAllocation)} · Investors collectively: {money(selected.investorAllocation)}{selected.investor1Percent !== undefined ? ` · Investor 1: ${selected.investor1Percent}% of investor pool` : ' · Individual investor split not configured'}</p>}
      <div className="form-actions"><button type="submit" disabled={busy}>{busy ? 'Saving…' : selected ? 'Update approved distribution' : 'Approve distribution'}</button></div>
    </form>
    {selected && <form className="card form-card" onSubmit={savePayment}>
      <div className="card-title">Record a payment</div>
      <div className="form-grid">
        <label>Recipient<select value={recipient} onChange={event => setRecipient(event.target.value as Recipient)}>
          {paymentRecipients.map(value => <option key={value} value={value}>{value === 'friend' ? 'Friend' : value === 'investors' ? 'Investors collectively' : value === 'investor1' ? 'Investor 1' : 'Investor 2'}</option>)}
        </select></label>
        <label>Payment amount<input type="number" min="0.01" step="0.01" required value={paymentAmount || ''} onChange={event => setPaymentAmount(Number(event.target.value))} /></label>
        <label>Payment date<input type="date" required value={paymentDate} onChange={event => setPaymentDate(event.target.value)} /></label>
        <label className="wide">Optional note<input maxLength={300} value={paymentNote} onChange={event => setPaymentNote(event.target.value)} /></label>
      </div>
      <div className="form-actions"><button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Record payment'}</button></div>
    </form>}
    <div className="card table-card"><div className="card-title">Monthly distribution history</div><div className="table-wrap">
      <table><thead><tr><th>Month</th><th>Approved</th><th>Friend 40%</th><th>Investors 60%</th><th>Paid</th><th>Status</th></tr></thead>
        <tbody>{records.map(record => <tr key={record.period}>
          <td>{record.period}</td><td>{money(record.approvedAmount)}</td><td>{money(record.friendAllocation)}</td><td>{money(record.investorAllocation)}</td>
          <td>{money(record.payments.reduce((sum, payment) => sum + payment.amount, 0))}</td><td>{record.status}</td>
        </tr>)}{records.length === 0 && <tr><td colSpan={6}>No distributions have been approved.</td></tr>}</tbody>
      </table>
    </div></div>
    {selected?.payments?.length ? <div className="card table-card"><div className="card-title">Payment details · {selected.period}</div><div className="table-wrap">
      <table><thead><tr><th>Recipient</th><th>Amount</th><th>Date</th><th>Note</th></tr></thead>
        <tbody>{selected.payments.map((payment, index) => <tr key={`${payment.paymentDate}-${payment.recipient}-${index}`}><td>{payment.recipient}</td><td>{money(payment.amount)}</td><td>{payment.paymentDate}</td><td>{payment.note || '—'}</td></tr>)}</tbody>
      </table>
    </div></div> : null}
  </section>;
}
