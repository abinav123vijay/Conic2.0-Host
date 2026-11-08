import Link from 'next/link';
import './login.css';
import './auth-links.css';
import LoginForm from './LoginForm';

export default function LoginPage() {
  return <main className="login-page">
    <div className="login-brand">
      <div className="brand-mark">C</div>
      <div><strong>CONIC</strong><span>Business System</span></div>
    </div>
    <section className="login-panel" aria-labelledby="login-title">
      <div className="login-kicker">BUSINESS TRACKER</div>
      <h1 id="login-title">Welcome back</h1>
      <p className="login-subtitle">Sign in to continue to your workspace.</p>
      <LoginForm />
      <p className="auth-switch">Need an account? <Link href="/signup">Create one</Link></p>
    </section>
    <footer className="login-footer">Private workspace · Secure sign in</footer>
  </main>;
}
