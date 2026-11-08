'use client';

import { useEffect, useRef } from 'react';

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  busyLabel?: string;
  confirmTone?: 'danger' | 'primary';
  dialogClassName?: string;
  busy?: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function ConfirmDialog({ open, title, description, confirmLabel = 'Delete', busyLabel = 'Deleting...', confirmTone = 'danger', dialogClassName = '', busy = false, error, onCancel, onConfirm }: ConfirmDialogProps) {
  const cancelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelButton.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return <div className="delete-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
    <section className={`delete-dialog ${dialogClassName}`.trim()} role="alertdialog" aria-modal="true" aria-labelledby="delete-dialog-title" aria-describedby="delete-dialog-description">
      <div className="delete-dialog-mark" aria-hidden="true">!</div>
      <h2 id="delete-dialog-title">{title}</h2>
      <p id="delete-dialog-description">{description}</p>
      {error && <p className="delete-dialog-error" role="alert">{error}</p>}
      <div className="delete-dialog-actions">
        <button ref={cancelButton} type="button" className="button secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className={`button ${confirmTone === 'danger' ? 'delete-dialog-confirm' : 'confirm-dialog-primary'}`} onClick={onConfirm} disabled={busy}>{busy ? busyLabel : confirmLabel}</button>
      </div>
    </section>
  </div>;
}
