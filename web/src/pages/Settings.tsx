import React, { useState } from 'react';
import { api, ApiError } from '../api.js';
import { useAuth } from '../App.js';

export default function Settings() {
  const { me, reload } = useAuth();
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      const r = await api.put<{ configured: boolean; login: string }>('/settings/github-token', {
        token: token.trim(),
      });
      setMsg({ ok: true, text: `Token for @${r.login} stored (AES-256-GCM encrypted at rest).` });
      setToken('');
      await reload();
    } catch (ex) {
      setMsg({ ok: false, text: ex instanceof ApiError ? ex.message : 'failed to store token' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    await api.del('/settings/github-token');
    setMsg({ ok: true, text: 'Token removed.' });
    await reload();
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="dim" style={{ margin: 0 }}>Workspace: <span className="mono">{me?.user.email}</span></p>
        </div>
      </div>

      <div className="drawer" style={{ maxWidth: 560 }}>
        <div className="mono small faint" style={{ marginBottom: 10, letterSpacing: '0.08em' }}>
          GITHUB CREDENTIAL {me?.githubTokenConfigured ? '· CONFIGURED' : '· NOT SET'}
        </div>
        <p className="dim small">
          A personal access token lifts GitHub API rate limits for your analyses and enables
          approval-gated remediation PRs. It is validated against GitHub, then stored encrypted
          (AES-256-GCM, key held only in server environment) and is never returned by any endpoint.
          Analyses work without it — anonymous against public APIs, within shared rate limits.
        </p>
        {msg && <div className={msg.ok ? 'form-ok' : 'form-error'}>{msg.text}</div>}
        {me?.githubTokenConfigured ? (
          <button className="btn danger" onClick={remove}>Remove stored token</button>
        ) : (
          <form onSubmit={save}>
            <div className="field">
              <label htmlFor="pat">Personal access token (repo scope for remediation)</label>
              <input id="pat" className="input" type="password" placeholder="ghp_… / gho_…"
                value={token} onChange={(e) => setToken(e.target.value)} required />
            </div>
            <button className="btn primary" disabled={busy}>{busy ? 'validating…' : 'Store token'}</button>
          </form>
        )}
      </div>
    </div>
  );
}
