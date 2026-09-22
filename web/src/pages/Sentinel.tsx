import React, { useState } from 'react';
import { api, ApiError, type SentinelResult } from '../api.js';
import { Sev } from '../components/bits.js';

export default function Sentinel() {
  const [repo, setRepo] = useState('');
  const [pr, setPr] = useState('');
  const [result, setResult] = useState<SentinelResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setResult(null);
    setBusy(true);
    try {
      setResult(await api.post<SentinelResult>('/sentinel', {
        repo: repo.trim(), pr: Number(pr),
      }));
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : 'preview failed');
    } finally {
      setBusy(false);
    }
  };

  const verdictTone = (v: string) =>
    v === 'block' ? 'critical' : v === 'warn' ? 'moderate' : v === 'pass' ? 'low' : 'info';

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Sentinel</h1>
          <p className="dim" style={{ margin: 0 }}>
            Pre-merge gate: what would this pull request deposit into your dependency strata?
          </p>
        </div>
      </div>

      <form onSubmit={run} className="drawer" style={{ marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: 12, alignItems: 'end' }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="srepo">Repository</label>
            <input id="srepo" className="input" placeholder="owner/name"
              value={repo} onChange={(e) => setRepo(e.target.value)} required
              pattern="[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+" />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="spr">PR #</label>
            <input id="spr" className="input" type="number" min={1} placeholder="571"
              value={pr} onChange={(e) => setPr(e.target.value)} required />
          </div>
          <button className="btn primary" disabled={busy}>{busy ? 'evaluating…' : 'Evaluate merge'}</button>
        </div>
      </form>

      {err && <div className="form-error">{err}</div>}

      {result && (
        <div>
          <div className="drawer" style={{ marginBottom: 20, borderColor: 'var(--sand-dim)' }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
              <span className={`chip ${verdictTone(result.verdict)}`} style={{ fontSize: 13 }}>
                VERDICT: {result.verdict.toUpperCase()}
              </span>
              <a href={result.pr.url} target="_blank" rel="noreferrer" className="mono small">
                #{result.pr.number} — {result.pr.title.slice(0, 70)}
              </a>
              <span className="faint small mono">
                by {result.pr.author} · {result.pr.approvals} approval(s)
              </span>
            </div>
            <p className="small dim" style={{ margin: 0 }}>{result.rationale}</p>
          </div>

          {result.delta.length > 0 && (
            <div className="table-wrap" style={{ marginBottom: 20 }}>
              <table className="data">
                <thead>
                  <tr><th>Incoming change</th><th>Resolves to</th><th>Advisories at that version</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {result.delta.map((d, i) => (
                    <tr key={i}>
                      <td>
                        <span className={`chip ${d.change === 'add' ? 'sand' : 'low'}`}>{d.change}</span>{' '}
                        <span className="mono">{d.package}</span>
                        <div className="faint small mono">{d.toRange ?? ''}</div>
                      </td>
                      <td className="mono small">{d.resolved ?? '—'}</td>
                      <td>
                        {d.vulns.length === 0
                          ? <span className="faint">—</span>
                          : d.vulns.map((v, j) => (
                            <div key={j} className="small"><Sev sev={v.severity} /> {v.id}: {v.summary.slice(0, 60)}</div>
                          ))}
                        {d.deprecated && <div className="chip moderate">deprecated</div>}
                      </td>
                      <td>
                        {d.vulns.some((v) => v.severity === 'critical' || v.severity === 'high')
                          ? <span className="chip critical">would accrue exposure</span>
                          : d.vulns.length > 0 || d.deprecated
                            ? <span className="chip moderate">review</span>
                            : <span className="chip low">clear</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result.retired.length > 0 && (
            <div className="drawer">
              <div className="mono small faint" style={{ marginBottom: 8, letterSpacing: '0.08em' }}>
                EXPOSURE RETIRED BY THIS MERGE
              </div>
              {result.retired.map((r, i) => (
                <div key={i} className="small">
                  <span style={{ color: 'var(--green)' }}>−{r.vulns}</span> advisories exit the strata —{' '}
                  <span className="mono">{r.package}</span> is removed
                </div>
              ))}
            </div>
          )}

          {result.delta.length === 0 && result.retired.length === 0 && (
            <div className="empty">No dependency manifest changes in this pull request.</div>
          )}
        </div>
      )}

      {!result && !err && (
        <div className="empty">
          Sentinel reconstructs the manifest at the PR's base and head revisions, diffs them, and
          checks every incoming package against live registry and OSV intelligence — before anyone merges.
        </div>
      )}
    </div>
  );
}
