'use client';

import '../entry-actions.css';
import { useEffect, useState } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';
import type { PurchaseEntry } from '@/types/domain';

type PurchaseForm = Omit<PurchaseEntry, '_id' | 'businessId' | 'createdAt' | 'updatedAt'>;
type PurchaseRow = {
  _id?: string;
  id?: string;
  purchaseDate: string;
  paymentDate?: string | null;
  vendorAmounts: Record<string, number>;
  onlinePurchasePaid?: number;
  cashPurchasePaid?: number;
  totalPurchases?: number;
};

const money = (n: number) => `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n || 0)}`;
const additionalPurchaseTypes = ['Other', 'Transport'] as const;

export default function PurchasesPage() {
  const [rows, setRows] = useState<PurchaseRow[]>([]);
  const [vendors, setVendors] = useState<string[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PurchaseRow | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PurchaseForm>({
    purchaseDate: new Date().toISOString().slice(0, 10),
    paymentDate: '',
    vendorAmounts: Object.fromEntries(additionalPurchaseTypes.map(type => [type, 0])),
    onlinePurchasePaid: 0,
    cashPurchasePaid: 0
  });

  const load = async () => {
    const userResponse = await fetch('/api/auth/me');
    if (!userResponse.ok) throw new Error('Unable to verify your account permissions.');
    const user = await userResponse.json();
    const owner = user.role === 'owner';
    const [purchasesResponse, settingsResponse] = await Promise.all([
      fetch('/api/purchases'),
      owner ? fetch('/api/settings') : Promise.resolve(null)
    ]);
    if (!purchasesResponse.ok) throw new Error('Could not load purchase records.');
    if (settingsResponse && !settingsResponse.ok) throw new Error('Could not load purchase settings.');
    setRows(await purchasesResponse.json());
    setVendors(settingsResponse ? (await settingsResponse.json()).vendors || [] : []);
    setIsOwner(owner);
  };

  useEffect(() => { load().catch(error => setLoadError(error instanceof Error ? error.message : 'Could not load purchase records.')); }, []);

  const resetForm = () => {
    setEditingId(null);
    setForm({
      purchaseDate: new Date().toISOString().slice(0, 10),
      paymentDate: '',
      vendorAmounts: Object.fromEntries([...vendors, ...additionalPurchaseTypes].map(type => [type, 0])),
      onlinePurchasePaid: 0,
      cashPurchasePaid: 0
    });
  };

  const editRow = (row: PurchaseRow) => {
    if (!isOwner || row.onlinePurchasePaid === undefined || row.cashPurchasePaid === undefined) return;
    setEditingId(String(row._id));
    setForm({
      purchaseDate: row.purchaseDate,
      paymentDate: row.paymentDate || '',
      vendorAmounts: { ...row.vendorAmounts },
      onlinePurchasePaid: row.onlinePurchasePaid,
      cashPurchasePaid: row.cashPurchasePaid
    });
  };

  const save = async () => {
    setBusy(true);
    try {
      const response = await fetch(editingId ? `/api/purchases/${editingId}` : '/api/purchases', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      if (!response.ok) throw new Error('Could not save purchase.');
      resetForm();
      await load();
    } finally {
      setBusy(false);
    }
  };

  const requestDelete = (row: PurchaseRow) => {
    setDeleteError('');
    setDeleteTarget(row);
  };

  const deleteRow = async () => {
    if (!isOwner || !deleteTarget) return;
    const id = String(deleteTarget._id);
    setDeletingId(id);
    try {
      const response = await fetch(`/api/purchases/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Could not delete purchase entry.');
      if (editingId === id) resetForm();
      setDeleteTarget(null);
      await load();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Could not delete purchase entry.');
    } finally {
      setDeletingId(null);
    }
  };

  return <section className="content">
    <div className="page-head"><div><h1>Purchases</h1><p>{isOwner ? 'Record vendor purchases and payment amounts.' : 'Read-only approved vendor purchase information.'}</p></div></div>
    {loadError && <p role="alert">{loadError}</p>}
    {isOwner && <div className="card form-card">
      <div className="form-grid">
        <label>Purchase Date<input type="date" value={form.purchaseDate} onChange={e => setForm({ ...form, purchaseDate: e.target.value })} /></label>
        <label>Payment Date<input type="date" value={form.paymentDate || ''} onChange={e => setForm({ ...form, paymentDate: e.target.value })} /></label>
        {vendors.map(vendor => <label key={vendor}>{vendor}<input type="number" value={form.vendorAmounts[vendor] || 0} onChange={e => setForm({ ...form, vendorAmounts: { ...form.vendorAmounts, [vendor]: Number(e.target.value) } })} /></label>)}
        {additionalPurchaseTypes.map(type => <label key={type}>{type}<input type="number" min="0" value={form.vendorAmounts[type] || 0} onChange={e => setForm({ ...form, vendorAmounts: { ...form.vendorAmounts, [type]: Number(e.target.value) } })} /></label>)}
        <label>Online Purchase Paid<input type="number" value={form.onlinePurchasePaid} onChange={e => setForm({ ...form, onlinePurchasePaid: Number(e.target.value) })} /></label>
        <label>Cash Purchase Paid<input type="number" value={form.cashPurchasePaid} onChange={e => setForm({ ...form, cashPurchasePaid: Number(e.target.value) })} /></label>
      </div>
      <div className="form-actions">
        <button onClick={save} disabled={busy}>{busy ? 'Saving...' : editingId ? 'Save Changes' : 'Add Purchase'}</button>
        {editingId && <button className="button secondary" onClick={resetForm} disabled={busy}>Cancel</button>}
      </div>
    </div>}
    <div className="card table-card">
      <div className="card-title">Saved Purchases</div>
      <div className="table-wrap"><table>
        <thead><tr><th>Purchase Date</th>{isOwner ? <><th>Payment Date</th><th>Other</th><th>Transport</th><th>Total</th><th>Paid</th><th>Pending</th><th>Actions</th></> : <>{[...new Set(rows.flatMap(row => Object.keys(row.vendorAmounts || {})))].map(vendor => <th key={vendor}>{vendor}</th>)}<th>Approved vendor purchases</th></>}</tr></thead>
        <tbody>{rows.map(row => {
          const total = Object.values(row.vendorAmounts || {}).reduce((sum, amount) => sum + Number(amount || 0), 0);
          const paid = Number(row.onlinePurchasePaid || 0) + Number(row.cashPurchasePaid || 0);
          return <tr key={String(row._id)}>
            <td>{row.purchaseDate}</td>
            {isOwner ? <><td>{row.paymentDate || '—'}</td><td>{money(row.vendorAmounts?.Other || 0)}</td><td>{money(row.vendorAmounts?.Transport || 0)}</td><td>{money(total)}</td><td>{money(paid)}</td><td>{money(Math.max(0, total - paid))}</td>
              <td><div className="entry-actions"><button className="button secondary" onClick={() => editRow(row)}>Edit</button><button className="button secondary delete-entry" onClick={() => requestDelete(row)} disabled={busy || deletingId === String(row._id)}>Delete</button></div></td></>
              : <>{[...new Set(rows.flatMap(item => Object.keys(item.vendorAmounts || {})))].map(vendor => <td key={vendor}>{money(row.vendorAmounts[vendor] || 0)}</td>)}<td>{money(row.totalPurchases ?? total)}</td></>}
          </tr>;
        })}</tbody>
      </table></div>
    </div>
    {isOwner && <ConfirmDialog open={Boolean(deleteTarget)} title="Delete this purchase entry?" description={deleteTarget ? `Purchase date: ${deleteTarget.purchaseDate}. This action cannot be undone.` : ''} confirmLabel="Delete entry" busy={Boolean(deletingId)} error={deleteError} onCancel={() => setDeleteTarget(null)} onConfirm={() => void deleteRow()} />}
  </section>;
}