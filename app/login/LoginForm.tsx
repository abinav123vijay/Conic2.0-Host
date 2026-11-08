'use client';

import { FormEvent, useState } from 'react';

export default function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error || 'Unable to sign in.');
        return;
      }
      const requested = new URLSearchParams(window.location.search).get('next');
      const destination = requested?.startsWith('/') && !requested.startsWith('//') ? requested : '/dashboard/monthly';
      window.location.assign(destination);
    } catch {
      setError('Could not reach the sign-in service. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return <form className="login-form" onSubmit={submit}>
    <label htmlFor="login-email">Email address</label>
    <input id="login-email" type="email" autoComplete="username" autoFocus required value={email} onChange={event => setEmail(event.target.value)} />
    <label htmlFor="login-password">Password</label>
    <input id="login-password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} />
    {error && <p className="login-error" role="alert">{error}</p>}
    <button type="submit" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
  </form>;
}
