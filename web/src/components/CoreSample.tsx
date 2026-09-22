import React, { useState } from 'react';
import type { DepositionEvent } from '../api.js';

/**
 * The core sample — Strata's signature visualization.
 * One horizontal band per deposition event, stacked from oldest (bottom) to
 * newest (top), like a sediment column. Color encodes event kind; red marks
 * a deposition whose package carries a known vulnerability today.
 */
export default function CoreSample({
  events,
  vulnerablePackages,
  repoUrl,
  height = 360,
}: {
  events: DepositionEvent[];
  vulnerablePackages: Set<string>;
  repoUrl?: string;
  height?: number;
}) {
  const [tip, setTip] = useState<{ x: number; y: number; ev: DepositionEvent } | null>(null);

  if (events.length === 0) {
    return <div className="empty">No deposition events in the analysis window.</div>;
  }

  const sorted = [...events].sort(
    (a, b) => new Date(a.committed_at).getTime() - new Date(b.committed_at).getTime(),
  );
  const shown = sorted.slice(-80); // cap visual density
  const bandH = Math.max(3, Math.min(16, (height - 24) / shown.length));
  const viewH = shown.length * bandH + 24;

  const color = (ev: DepositionEvent) => {
    if (vulnerablePackages.has(ev.package)) return '#e5484d';
    switch (ev.kind) {
      case 'add': return '#e2b04a';
      case 'bump': return '#56c8d8';
      default: return '#33414c';
    }
  };

  const first = new Date(shown[0].committed_at).getFullYear();
  const last = new Date(shown[shown.length - 1].committed_at).getFullYear();

  return (
    <div className="core-sample" style={{ position: 'relative' }}>
      <div className="small faint mono" style={{ marginBottom: 8 }}>
        CORE SAMPLE · {shown.length} deposition events · {first} → {last}
        {sorted.length > shown.length ? ` · showing latest ${shown.length}` : ''}
      </div>
      <svg
        width="100%"
        viewBox={`0 0 640 ${viewH}`}
        preserveAspectRatio="none"
        onMouseLeave={() => setTip(null)}
      >
        {shown.map((ev, i) => {
          const y = viewH - 12 - (i + 1) * bandH;
          const w = ev.kind === 'add' ? 420 : ev.kind === 'bump' ? 300 : 180;
          const c = color(ev);
          return (
            <rect
              key={ev.id}
              x={70}
              y={y}
              width={w}
              height={Math.max(2, bandH - 1.5)}
              rx={1}
              fill={c}
              opacity={ev.kind === 'remove' ? 0.45 : 0.92}
              onMouseEnter={(e) => setTip({
                x: (e as any).clientX, y: (e as any).clientY, ev,
              })}
              style={{ cursor: 'crosshair' }}
            />
          );
        })}
        {/* time axis */}
        <line x1={70} y1={viewH - 8} x2={560} y2={viewH - 8} stroke="#1d2830" />
        <text x={70} y={viewH - 0.5} fill="#5c6f7c" fontSize={9}>{first}</text>
        <text x={530} y={viewH - 0.5} fill="#5c6f7c" fontSize={9}>{last}</text>
        {/* legend */}
        <rect x={570} y={16} width={9} height={9} fill="#e2b04a" />
        <text x={583} y={24} fill="#8ca0ae" fontSize={9}>add</text>
        <rect x={570} y={32} width={9} height={9} fill="#56c8d8" />
        <text x={583} y={40} fill="#8ca0ae" fontSize={9}>bump</text>
        <rect x={570} y={48} width={9} height={9} fill="#33414c" />
        <text x={583} y={56} fill="#8ca0ae" fontSize={9}>remove</text>
        <rect x={570} y={64} width={9} height={9} fill="#e5484d" />
        <text x={583} y={72} fill="#8ca0ae" fontSize={9}>vulnerable</text>
      </svg>
      {tip && (
        <div className="tip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 340), top: tip.y + 14 }}>
          <div><span style={{ color: '#e2b04a' }}>{tip.ev.kind}</span> {tip.ev.package}</div>
          <div className="faint">{new Date(tip.ev.committed_at).toISOString().slice(0, 10)} · {tip.ev.author ?? 'unknown'}</div>
          {tip.ev.from_range && <div className="faint">{tip.ev.from_range} → {tip.ev.to_range}</div>}
          {repoUrl && (
            <div>
              <a href={`${repoUrl}/commit/${tip.ev.commit_sha}`} target="_blank" rel="noreferrer">
                {tip.ev.commit_sha.slice(0, 8)}
              </a>
              {tip.ev.pr_number ? ` · PR #${tip.ev.pr_number}` : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
