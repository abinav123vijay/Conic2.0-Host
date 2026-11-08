'use client';

import { FormEvent, useState } from 'react';

export default function SignupForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, inviteCode })
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error || 'Unable to create account.');
        return;
      }
      window.location.assign('/dashboard/monthly');
    } catch {
      setError('Could not reach the sign-up service. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return <form className="login-form" onSubmit={submit}>
    <label htmlFor="signup-email">Email address</label>
    <input id="signup-email" type="email" autoComplete="email" autoFocus required value={email} onChange={event => setEmail(event.target.value)} />
    <label htmlFor="signup-password">Password</label>
    <input id="signup-password" type="password" autoComplete="new-password" minLength={12} required value={password} onChange={event => setPassword(event.target.value)} />
    <label htmlFor="signup-confirm-password">Confirm password</label>
    <input id="signup-confirm-password" type="password" autoComplete="new-password" minLength={12} required value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} />
    <label htmlFor="signup-invite-code">Invite code</label>
    <input id="signup-invite-code" type="password" autoComplete="off" required value={inviteCode} onChange={event => setInviteCode(event.target.value)} />
    {error && <p className="login-error" role="alert">{error}</p>}
    <button type="submit" disabled={busy}>{busy ? 'Creating account...' : 'Create account'}</button>
  </form>;
}
