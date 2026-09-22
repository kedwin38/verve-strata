import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  api, ApiError, type Finding, type Investigation,
} from '../api.js';
import { Sev, fmtNum } from '../components/bits.js';

export default function FindingPage() {
  const { id, findingId } = useParams<{ id: string; findingId: string }>();
  const [finding, setFinding] = useState<Finding | null>(null);
  const [inv, setInv] = useState<Investigation | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [applyMsg, setApplyMsg] = useState<{ ok: boolean; text: string; url?: string } | null>(null);

  useEffect(() => {
    if (!id || !findingId) return;
    void api.get<{ findings: Finding[] }>(`/analyses/${id}/findings`).then((r) => {
      setFinding(r.findings.find((f) => f.id === findingId) ?? null);
    });
  }, [id, findingId]);

  const investigate = async () => {
    if (!findingId) return;
    setBusy(true);
    setErr(null);
    try {
      setInv(await api.post<Investigation>(`/findings/${findingId}/investigate`));
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : 'investigation failed');
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!inv) return;
    setApplyMsg(null);
    try {
      const r = await api.post<{ applied: true; pr: { number: number; url: string } }>(`/investigations/${inv.id}/apply`);
      setApplyMsg({ ok: true, text: `Remediation pull request #${r.pr.number} opened.`, url: r.pr.url });
    } catch (ex) {
      setApplyMsg({
        ok: false,
        text: ex instanceof ApiError ? ex.message : 'apply failed',
      });
    }
  };

  if (!finding) return <div className="empty">loading finding…</div>;

  const d = finding.detail ?? {};
  const intro = d.introducedBy;

  return (
    <div>
      <div className="page-head">
        <div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Sev sev={finding.severity} />
            <span className="chip">{finding.kind}</span>
            <h1 style={{ fontSize: 16, margin: 0 }} className="mono">{finding.package}</h1>
          </div>
          <p className="dim small" style={{ margin: '6px 0 0' }}>{finding.title}</p>
        </div>
        <Link to={`/app/a/${id}`} className="btn">← report</Link>
      </div>

      <div className="drawer" style={{ marginBottom: 20 }}>
        <div className="kv">
          <span className="k">advisory</span>
          <span>{d.osvId ? <a href={d.url} target="_blank" rel="noreferrer">{d.osvId}</a> : '—'}</span>
          <span className="k">resolved version</span>
          <span className="mono">{d.resolvedVersion ?? '—'} <span className="faint">({d.resolvedHow ?? 'unresolved'})</span></span>
          <span className="k">vulnerable range</span><span className="mono small">{d.vulnerableRange ?? '—'}</span>
          <span className="k">fixed in</span><span className="mono">{d.fixedIn ?? 'no fix published'}</span>
          <span className="k">cvss</span><span className="mono">{d.cvss ?? '—'}</span>
          <span className="k">exposure-days</span><span className="mono">{fmtNum(finding.exposure_days)}</span>
          <span className="k">introduced by</span>
          <span>
            {intro ? (
              <>
                <span className="mono">{intro.author ?? 'unknown'}</span> · {String(intro.at).slice(0, 10)}
                {intro.pr && <> · PR <span className="mono">#{intro.pr}</span></>}
                {intro.confidence === 'predates-window' && <span className="faint"> (predates analysis window)</span>}
              </>
            ) : 'provenance not determined'}
          </span>
          <span className="k">usage</span>
          <span className="small mono">{(d.usageFiles ?? []).join(', ') || 'no references found in sampled files'}</span>
        </div>
      </div>

      {!inv ? (
        <div>
          <button className="btn primary" onClick={investigate} disabled={busy}>
            {busy ? 'reasoning…' : 'Run forensic investigation →'}
          </button>
          {err && <div className="form-error" style={{ marginTop: 12 }}>{err}</div>}
          <p className="faint small" style={{ maxWidth: 560 }}>
            The reasoner is deterministic and evidence-bound: it executes a fixed plan of tool calls
            (provenance lookup, PR review state, usage, registry versions, fix availability) and emits a
            causal chain whose every node cites its evidence. Confidence is computed from evidence
            completeness — it cannot hallucinate, only be incomplete.
          </p>
        </div>
      ) : (
        <div className="split">
          <div>
            <div className="mono small faint" style={{ marginBottom: 10, letterSpacing: '0.08em' }}>
              CAUSAL CHAIN · confidence {inv.confidence}
            </div>
            <div className="chain">
              {(inv.chain?.nodes ?? []).map((n, i) => (
                <React.Fragment key={n.id}>
                  {i > 0 && <div className="chain-link" />}
                  <div className="chain-node">
                    <div className="ntype">{n.type}</div>
                    <div className="nlabel">{n.label}</div>
                    {n.evidence.map((e, j) => (
                      <div className="evi" key={j}>
                        ⌗ {e.url ? <a href={e.url} target="_blank" rel="noreferrer">{e.source}</a> : e.source}
                        {' '}· digest {e.digest}
                      </div>
                    ))}
                  </div>
                </React.Fragment>
              ))}
            </div>
          </div>
          <div>
            <div className="drawer" style={{ marginBottom: 16 }}>
              <div className="mono small faint" style={{ marginBottom: 8, letterSpacing: '0.08em' }}>RECOMMENDATION</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <span className="chip sand">{inv.recommendation.action}</span>
                <span className={`chip ${inv.recommendation.urgency === 'immediate' ? 'critical' : inv.recommendation.urgency === 'soon' ? 'high' : 'info'}`}>
                  urgency: {inv.recommendation.urgency}
                </span>
                {inv.recommendation.target && <span className="chip low mono">→ {inv.recommendation.target}</span>}
              </div>
              <p className="small" style={{ color: 'var(--ink)' }}>{inv.recommendation.rationale}</p>
              {inv.recommendation.patch && (
                <div className="prolog" style={{ marginBottom: 10 }}>
                  <div className="faint">{inv.recommendation.patch.path}</div>
                  <div style={{ color: '#f0a0a3' }}>- {inv.recommendation.patch.from}</div>
                  <div style={{ color: '#9fd8ac' }}>+ {inv.recommendation.patch.to}</div>
                </div>
              )}
              {inv.recommendation.rollbackNote && (
                <p className="faint small">rollback: {inv.recommendation.rollbackNote}</p>
              )}
              {inv.recommendation.action === 'upgrade-major' && inv.recommendation.patch && (
                <div>
                  <button className="btn primary" onClick={apply}>
                    Approve &amp; open remediation PR
                  </button>
                  <p className="faint small" style={{ marginTop: 8 }}>
                    Requires a GitHub token with write access to this repository (Settings).
                    Runs only on your explicit approval; audited.
                  </p>
                </div>
              )}
              {applyMsg && (
                <div className={applyMsg.ok ? 'form-ok' : 'form-error'} style={{ marginTop: 10 }}>
                  {applyMsg.text}
                  {applyMsg.url && <> · <a href={applyMsg.url} target="_blank" rel="noreferrer">view PR</a></>}
                </div>
              )}
            </div>
            <div className="drawer">
              <div className="mono small faint" style={{ marginBottom: 8, letterSpacing: '0.08em' }}>TOOL TRACE</div>
              {(inv.tool_trace ?? []).map((t, i) => (
                <div key={i} className="small mono" style={{ marginBottom: 4 }}>
                  <span style={{ color: t.ok ? 'var(--green)' : 'var(--red)' }}>{t.ok ? '✓' : '✗'}</span>{' '}
                  {t.tool} <span className="faint">({t.ms}ms)</span>
                  {t.note && <div className="faint" style={{ marginLeft: 14 }}>{t.note}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
