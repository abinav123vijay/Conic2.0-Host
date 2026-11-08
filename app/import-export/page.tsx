'use client';

import { useState } from 'react';

export default function ImportExportPage() {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!confirmed) {
      setMessage('Confirm that you want to replace Truck 2 settings, daily entries, and purchases before importing.');
      event.target.value = '';
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch('/api/excel/import', { method: 'POST', body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Import failed.');
      setMessage(`Imported ${result.daily} daily entries and ${result.purchases} purchase entries.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Import failed.');
    } finally {
      setBusy(false);
      event.target.value = '';
    }
  };

  return <section className="content">
    <div className="page-head"><div><h1>Excel Import / Export</h1><p>Export and import Truck 2 operational records.</p></div></div>
    <div className="card form-card"><h3>Export CONIC Truck 2 workbook</h3>
      <p>Downloads settings, daily entries, purchases, rent, partner distributions, and owner-only reconciliation data. No loan or EMI records are included.</p>
      <a className="button" href="/api/excel/export">Export Excel Workbook</a>
    </div>
    <div className="card form-card"><h3>Import Excel</h3>
      <p>Import replaces existing Truck 2 settings, daily entries, and purchases. Rent, partner distributions, users, and reconciliation records are not imported.</p>
      <label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> I understand this replaces the current Truck 2 settings, daily entries, and purchases.</label>
      <input type="file" accept=".xlsx" onChange={upload} disabled={busy || !confirmed} />
      {message && <div className="status" role="status">{message}</div>}
    </div>
  </section>;
}
