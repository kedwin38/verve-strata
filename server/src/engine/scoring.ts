/**
 * Scoring: exposure-day accounting and risk indices.
 *
 * Definitions (also rendered in the UI and README — these are the product's
 * units, not decorations):
 *
 *  Exposure-days of a vulnerability v
 *    = W(severity_v) × days( now − start_v ), where
 *    start_v = max( introduction_date(dep), published(v) )
 *    A vulnerability cannot accrue exposure before it was disclosed, nor
 *    before the dependency that carries it entered the codebase.
 *
 *  W = { critical: 1.5, high: 0.7, moderate: 0.3, low: 0.1 }
 *
 *  Risk index of a dependency = 100·tanh( raw / 3 ), bounded, monotonic.
 *    raw = Σ_v W_v · min(days_v, 1825)/365 · 2
 *        + 0.5·deprecated + 0.3·stale + 0.2·unreviewed_introduction
 *        all × usage factor (0.6 + 0.4·breadth)
 */
import type { MappedVuln } from '../services/osv.js';

export type Severity = MappedVuln['severity'];

export const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 1.5,
  high: 0.7,
  moderate: 0.3,
  low: 0.1,
  info: 0,
};

export interface ExposureInput {
  vulns: MappedVuln[];
  introducedAt: Date | null;
  now: Date;
}

export interface VulnExposure {
  id: string;
  days: number;
  weight: number;
  exposureDays: number;
}

export function exposureForVulns(input: ExposureInput): {
  total: number;
  perVuln: VulnExposure[];
} {
  const perVuln: VulnExposure[] = [];
  let total = 0;
  for (const v of input.vulns) {
    const published = v.published ? new Date(v.published) : null;
    const introduced = input.introducedAt;
    let start: Date | null = null;
    if (introduced && published) start = introduced > published ? introduced : published;
    else start = introduced ?? published;

    let days = 0;
    if (start) {
      days = Math.max(0, (input.now.getTime() - start.getTime()) / 86_400_000);
    }
    const weight = SEVERITY_WEIGHT[v.severity] ?? 0.3;
    const exposureDays = weight * days;
    perVuln.push({ id: v.id, days: Math.round(days), weight, exposureDays });
    total += exposureDays;
  }
  return { total, perVuln };
}

export interface RiskInput {
  exposureDays: number;
  deprecated: boolean;
  staleDays: number | null;      // age gap between resolved and latest version
  reviewed: boolean | null;      // null = unknown → no penalty, no credit
  usageFileCount: number;
}

export interface RiskResult {
  risk: number;                  // 0..100
  factors: { label: string; contribution: number }[];
}

export function riskIndex(input: RiskInput): RiskResult {
  const factors: { label: string; contribution: number }[] = [];

  const vulnRaw = Math.min(input.exposureDays, 1_000) / 365 * 2;
  if (vulnRaw > 0) factors.push({ label: `vulnerability exposure (${Math.round(input.exposureDays)} exposure-days)`, contribution: vulnRaw });

  let raw = vulnRaw;
  if (input.deprecated) {
    raw += 0.5;
    factors.push({ label: 'package deprecated at resolved version', contribution: 0.5 });
  }
  if (input.staleDays !== null && input.staleDays > 730) {
    const stale = 0.3;
    raw += stale;
    factors.push({ label: `resolved version >2y behind latest (${Math.round(input.staleDays / 365)}y)`, contribution: stale });
  }
  if (input.reviewed === false) {
    const unreviewed = 0.2;
    raw += unreviewed;
    factors.push({ label: 'introduced without review', contribution: unreviewed });
  }

  const breadth = Math.min(input.usageFileCount, 10) / 10;
  const usageFactor = 0.6 + 0.4 * breadth;

  return {
    risk: Math.round(100 * Math.tanh((raw * usageFactor) / 3) * 10) / 10,
    factors,
  };
}

export function repoRiskIndex(deps: { risk: number; exposureDays: number }[]): {
  risk: number;
  totalExposureDays: number;
} {
  const totalExposureDayss = deps.reduce((s, d) => s + d.exposureDays, 0);
  const risk = deps.length
    ? Math.round((deps.reduce((s, d) => s + d.risk, 0) / deps.length) * 10) / 10
    : 0;
  return { risk, totalExposureDays: Math.round(totalExposureDayss) };
}

/** Severity ordering for UI + finding triage. */
export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 5, high: 4, moderate: 3, low: 2, info: 1,
};
