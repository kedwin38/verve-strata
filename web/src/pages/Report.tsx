import React, { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  api, type Analysis, type Stratum, type DepositionEvent, type Finding,
} from '../api.js';
import CoreSample from '../components/CoreSample.js';
import { Sev, RiskBar, Stat, fmtDate, daysAgo, fmtNum } from '../components/bits.js';

export default function Report() {
  const { id } = useParams<{ id: string }>();
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [strata, setStrata] = useState<Stratum[]>([]);
  const [events, setEvents] = useState<DepositionEvent[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [selected, setSelected] = useState<Stratum | null>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    const load = async () => {
      const a = await api.get<Analysis>(`/analyses/${id}`);
      if (!alive) return;
      setAnalysis(a);
      if (a.status === 'complete' || a.status === 'failed') {
        const [s, e, f] = await Promise.all([
          api.get<{ strata: Stratum[] }>(`/analyses/${id}/strata`),
          api.get<{ events: DepositionEvent[] }>(`/analyses/${id}/events`),
          api.get<{ findings: Finding[] }>(`/analyses/${id}/findings`),
        ]);
        if (!alive) return;
        setStrata(s.strata); setEvents(e.events); setFindings(f.findings);
      }
    };
    void load();
    const t = setInterval(() => {
      void load();
    }, analysis && (analysis.status === 'queued' || analysis.status === 'running') ? 2500 : 100000);
    return () => { alive = false; clearInterval(t); };
  }, [id, analysis?.status]);

  const vulnerablePkgs = useMemo(
    () => new Set(strata.filter((s) => s.vulns.length > 0).map((s) => s.name)),
    [strata],
  );

  if (!analysis) return <div className="empty">loading core…</div>;

  const s = analysis.stats ?? {};
  const repoUrl = `https://github.com/${analysis.owner}/${analysis.repo}`;

  if (analysis.status === 'queued' || analysis.status === 'running') {
    return (
      <div>
        <h1 className="mono" style={{ fontSize: 16 }}>{analysis.owner}/{analysis.repo}</h1>
        <p className="dim"><span className="pulse" style={{ marginRight: 8 }} />extracting stratigraphy…</p>
        <div className="prolog">
          {(analysis.progress ?? []).slice().reverse().map((p, i) => (
            <div key={i}>
              <span className="t">{p.t.slice(11, 19)}</span>{' '}
              <span className="phase">[{p.phase}]</span> {p.msg}
            </div>
          ))}
          {(analysis.progress ?? []).length === 0 && <div className="faint">queued…</div>}
        </div>
      </div>
    );
  }

  if (analysis.status === 'failed') {
    return (
      <div>
        <h1 className="mono" style={{ fontSize: 16 }}>{analysis.owner}/{analysis.repo}</h1>
        <div className="form-error" style={{ marginTop: 16 }}>
          extraction failed — {analysis.error}
        </div>
        <p className="dim small">
          Common causes: repository not public, no root package.json/requirements.txt,
          or GitHub API rate limits (store a personal token in Settings to lift them).
        </p>
        <Link to="/app" className="btn">← back to cores</Link>
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="mono" style={{ fontSize: 17 }}>
            <a href={repoUrl} target="_blank" rel="noreferrer">{analysis.owner}/{analysis.repo}</a>
          </h1>
          <p className="dim small" style={{ margin: 0 }}>
            {analysis.ecosystem} · branch <code className="inline">{analysis.branch}</code> ·
            {' '}{s.revisions ?? 0} manifest revisions · extracted {daysAgo(analysis.created_at)}
            {analysis.truncated && <> · <span style={{ color: 'var(--orange)' }}>history deeper than analysis window (truncated)</span></>}
            {(analysis.degraded ?? []).length > 0 && <> · <span style={{ color: 'var(--orange)' }}>{analysis.degraded.length} upstream lookups degraded</span></>}
          </p>
        </div>
        <Link to="/app" className="btn">← cores</Link>
      </div>

      <div className="stat-row">
        <Stat v={s.deps ?? 0} l="direct deps" />
        <Stat v={s.events ?? 0} l="deposition events" tone="sand" />
        <Stat v={s.vulns ?? 0} l="known vulns" tone={s.vulns ? 'mid' : 'good'} />
        <Stat v={fmtNum(s.totalExposureDays)} l="exposure-days" tone={Number(s.totalExposureDays) > 100 ? 'warn' : 'mid'} />
        <Stat v={fmtNum(s.risk)} l="risk index" tone={Number(s.risk) > 50 ? 'warn' : undefined} />
      </div>

      <div className="split" style={{ marginBottom: 24 }}>
        <div>
          <CoreSample events={events} vulnerablePackages={vulnerablePkgs} repoUrl={repoUrl} />
        </div>
        <div>
          <div className="drawer">
            <div className="mono small faint" style={{ marginBottom: 10, letterSpacing: '0.08em' }}>FINDINGS ({findings.length})</div>
            {findings.length === 0 && <div className="dim small">No advisories at resolved versions. The sediment is clean — for now.</div>}
            {findings.slice(0, 12).map((f) => (
              <Link key={f.id} to={`/app/a/${id}/f/${f.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className={`finding ${f.severity}`}>
                  <div className="f-head">
                    <Sev sev={f.severity} />
                    <span className="f-title">{f.package}</span>
                    {Number(f.exposure_days) > 0 && (
                      <span className="chip sand">{fmtNum(f.exposure_days)} exp-days</span>
                    )}
                  </div>
                  <div className="f-meta">{f.title.slice(0, 90)}</div>
                </div>
              </Link>
            ))}
            {findings.length > 12 && (
              <div className="faint small">+ {findings.length - 12} more in the strata table below</div>
            )}
          </div>
        </div>
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Package</th><th>Resolved</th><th>Introduced</th><th>By</th>
              <th>Usage</th><th>Advisories</th><th>Exposure-days</th><th>Risk</th>
            </tr>
          </thead>
          <tbody>
            {strata.map((st) => (
              <tr key={st.id} className="clickable" onClick={() => setSelected(st)}>
                <td>
                  <span className="mono">{st.name}</span>
                  {st.deprecated && <span className="chip moderate" style={{ marginLeft: 6 }}>deprecated</span>}
                  {st.dep_kind === 'dev' && <span className="chip info" style={{ marginLeft: 6 }}>dev</span>}
                  <div className="faint small mono">{st.constraint_range ?? 'unpinned'}</div>
                </td>
                <td className="mono small">
                  {st.resolved_version ?? '—'}
                  {st.resolved_version && st.latest_version && st.resolved_version !== st.latest_version && (
                    <div className="faint">latest {st.latest_version}</div>
                  )}
                </td>
                <td className="small">
                  {st.introduced_at ? fmtDate(st.introduced_at) : '—'}
                  <div className="faint">
                    {st.introduction_confidence === 'predates-window' ? 'predates window' : ''}
                  </div>
                </td>
                <td className="small mono">
                  {st.introduced_author ?? '—'}
                  {st.introduced_pr && <> · <a href={`${repoUrl}/pull/${st.introduced_pr}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>#{st.introduced_pr}</a></>}
                  {st.reviewed === false && <div style={{ color: 'var(--orange)' }}>unreviewed</div>}
                  {st.reviewed === true && <div style={{ color: 'var(--green)' }}>reviewed</div>}
                </td>
                <td className="mono small">{st.usage_files.length ? `${st.usage_files.length} files` : <span className="faint">unreferenced</span>}</td>
                <td>
                  {st.vulns.length === 0 ? <span className="faint">—</span> : st.vulns.map((v) => (
                    <a key={v.id} href={v.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                      <span className={`chip ${v.severity}`} style={{ marginRight: 4 }}>{v.severity}</span>
                    </a>
                  ))}
                </td>
                <td className="mono">{Number(st.exposure_days) > 0 ? fmtNum(st.exposure_days) : '—'}</td>
                <td><RiskBar risk={Number(st.risk)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div style={{ marginTop: 24 }} className="drawer">
          <div className="page-head" style={{ marginBottom: 12 }}>
            <div className="mono" style={{ fontWeight: 600 }}>{selected.name}</div>
            <button className="btn" onClick={() => setSelected(null)}>close</button>
          </div>
          <div className="kv">
            <span className="k">constraint</span><span className="mono">{selected.constraint_range ?? 'unpinned'}</span>
            <span className="k">resolved</span>
            <span className="mono">
              {selected.resolved_version ?? '—'}
              {selected.resolved_version === selected.latest_version
                ? <span className="faint"> (latest)</span>
                : <span className="faint"> (latest {selected.latest_version ?? '?'}, {daysAgo(selected.latest_published_at)})</span>}
            </span>
            <span className="k">introduced</span>
            <span>
              {fmtDate(selected.introduced_at)} by <span className="mono">{selected.introduced_author ?? 'unknown'}</span>
              {selected.introduced_commit && <> · <a href={`${repoUrl}/commit/${selected.introduced_commit}`} target="_blank" rel=" noreferrer">{selected.introduced_commit.slice(0, 8)}</a></>}
              {selected.introduced_pr && <> · PR <a href={`${repoUrl}/pull/${selected.introduced_pr}`} target="_blank" rel="noreferrer">#{selected.introduced_pr}</a></>}
            </span>
            <span className="k">review state</span>
            <span>{selected.reviewed === null ? 'unknown' : selected.reviewed ? 'reviewed (approved)' : 'unreviewed'}</span>
            <span className="k">usage</span>
            <span className="small mono">{selected.usage_files.slice(0, 6).join(', ') || 'no references in sampled files'} {selected.usage_sampled > 0 && <span className="faint">(of {selected.usage_sampled} sampled)</span>}</span>
            <span className="k">risk factors</span>
            <span>{selected.risk_factors.map((f, i) => <div key={i} className="small">· {f.label}</div>)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
