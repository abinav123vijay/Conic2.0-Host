import Link from 'next/link';
import '../login/login.css';
import '../login/auth-links.css';
import SignupForm from './SignupForm';

export default function SignupPage() {
  return <main className="login-page">
    <div className="login-brand">
      <div className="brand-mark">C</div>
      <div><strong>CONIC</strong><span>Business System</span></div>
    </div>
    <section className="login-panel" aria-labelledby="signup-title">
      <div className="login-kicker">BUSINESS TRACKER</div>
      <h1 id="signup-title">Create account</h1>
      <p className="login-subtitle">Register for your CONIC workspace.</p>
      <SignupForm />
      <p className="auth-switch">Already registered? <Link href="/login">Sign in</Link></p>
    </section>
    <footer className="login-footer">An invite code is required. Your code determines your workspace access.</footer>
  </main>;
}
