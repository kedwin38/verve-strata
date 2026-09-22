import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api.js';
import { useAuth } from '../App.js';
import { Logo } from '../App.js';

export default function Auth({ mode }: { mode: 'login' | 'register' }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { reload } = useAuth();
  const nav = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      if (mode === 'register') await api.post('/auth/register', { email, password });
      else await api.post('/auth/login', { email, password });
      await reload();
      nav('/app');
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : 'network error — try again');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <nav className="nav">
        <div className="shell nav-inner">
          <Link to="/" className="nav-brand">
            <Logo />
            <span className="wordmark">VERVE <em>STRATA</em></span>
          </Link>
        </div>
      </nav>
      <div className="auth-wrap">
        <h1>{mode === 'register' ? 'Create your workspace' : 'Sign in'}</h1>
        <p className="dim small" style={{ marginTop: 0 }}>
          {mode === 'register'
            ? 'Accounts scope analyses, findings, and stored credentials.'
            : 'Welcome back to the sediment.'}
        </p>
        {err && <div className="form-error">{err}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" className="input" type="email" autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="password">{mode === 'register' ? 'Password (min 10 chars)' : 'Password'}</label>
            <input id="password" className="input" type="password"
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button className="btn primary" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>
            {busy ? '…' : mode === 'register' ? 'Create account' : 'Sign in'}
          </button>
        </form>
        <p className="dim small" style={{ marginTop: 16 }}>
          {mode === 'register' ? (
            <>Already have an account? <Link to="/login">Sign in</Link></>
          ) : (
            <>New here? <Link to="/register">Create an account</Link></>
          )}
        </p>
      </div>
    </div>
  );
}
