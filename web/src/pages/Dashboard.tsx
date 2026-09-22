import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, type Analysis } from '../api.js';
import { fmtDate } from '../components/bits.js';

export default function Dashboard() {
  const [analyses, setAnalyses] = useState<Analysis[] | null>(null);
  const [repo, setRepo] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  const load = async () => {
    try {
      const r = await api.get<{ analyses: Analysis[] }>('/analyses');
      setAnalyses(r.analyses);
    } catch {
      setAnalyses([]);
    }
  };
  useEffect(() => { void load(); }, []);

  // poll while anything is in flight
  useEffect(() => {
    if (!analyses?.some((a) => a.status === 'queued' || a.status === 'running')) return;
    const t = setInterval(() => void load(), 2500);
    return () => clearInterval(t);
  }, [analyses]);

  const launch = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const r = await api.post<{ id: string }>('/analyses', { repo: repo.trim() });
      nav(`/app/a/${r.id}`);
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : 'failed to queue analysis');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Cores</h1>
          <p className="dim" style={{ margin: 0 }}>
            Each core is a full stratigraphic extraction of one repository's dependency history.
          </p>
        </div>
      </div>

      <form onSubmit={launch} className="drawer" style={{ marginBottom: 24 }}>
        <div className="field" style={{ marginBottom: 8 }}>
          <label htmlFor="repo">New stratigraphy — public GitHub repository</label>
          <input
            id="repo" className="input" placeholder="owner/name  (e.g. expressjs/express)"
            value={repo} onChange={(e) => setRepo(e.target.value)}
            pattern="[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+" required
          />
        </div>
        {err && <div className="form-error">{err}</div>}
        <button className="btn primary" disabled={busy}>
          {busy ? 'queueing…' : 'Extract core →'}
        </button>
        <span className="faint small" style={{ marginLeft: 12 }}>
          walks manifest history · joins registry + OSV.dev · samples import usage
        </span>
      </form>

      {analyses === null ? (
        <div className="empty">loading…</div>
      ) : analyses.length === 0 ? (
        <div className="empty">
          No cores extracted yet. Point Strata at any public repository above —
          try one with some history to see the layers.
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Repository</th><th>Branch</th><th>Status</th>
                <th>Deps</th><th>Vulns</th><th>Exposure-days</th><th>Extracted</th>
              </tr>
            </thead>
            <tbody>
              {analyses.map((a) => {
                const s = a.stats ?? {};
                return (
                  <tr key={a.id} className="clickable" onClick={() => nav(`/app/a/${a.id}`)}>
                    <td className="mono">{a.owner}/{a.repo}</td>
                    <td className="dim mono small">{a.branch ?? '—'}</td>
                    <td>
                      {a.status === 'complete' && <span className="chip low">complete</span>}
                      {a.status === 'failed' && <span className="chip critical">failed</span>}
                      {(a.status === 'queued' || a.status === 'running') && (
                        <span className="chip sand"><span className="pulse" /> {a.status}</span>
                      )}
                    </td>
                    <td className="mono">{s.deps ?? '—'}</td>
                    <td className="mono">{s.vulns ?? '—'}</td>
                    <td className="mono">{s.totalExposureDays ?? '—'}</td>
                    <td className="dim small mono">{fmtDate(a.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
