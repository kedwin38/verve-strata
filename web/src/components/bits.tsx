import React from 'react';

export function Sev({ sev }: { sev: string }) {
  return <span className={`chip ${sev}`}>{sev}</span>;
}

export function RiskBar({ risk }: { risk: number }) {
  const cls = risk >= 60 ? 'hi' : risk >= 30 ? 'md' : '';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div className={`riskbar ${cls}`}>
        <i style={{ width: `${Math.min(100, Math.max(2, risk))}%` }} />
      </div>
      <span className="mono small dim">{risk.toFixed(0)}</span>
    </div>
  );
}

export function Stat({ v, l, tone }: { v: React.ReactNode; l: string; tone?: 'warn' | 'mid' | 'good' | 'sand' }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <div className="v">{v}</div>
      <div className="l">{l}</div>
    </div>
  );
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toISOString().slice(0, 10);
}

export function fmtNum(n: number | string | null | undefined): string {
  const v = typeof n === 'string' ? Number(n) : n;
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return v >= 1000 ? Math.round(v).toLocaleString('en-US') : String(Math.round(v * 10) / 10);
}

export function daysAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const days = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  if (days > 730) return `${(days / 365).toFixed(1)}y ago`;
  if (days > 60) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days)}d ago`;
}
