import { describe, it, expect } from 'vitest';
import { exposureForVulns, riskIndex, repoRiskIndex } from '../src/engine/scoring.js';

const NOW = new Date('2026-01-01T00:00:00Z');
const vuln = (sev: any, published?: string) => ({
  id: 'GHSA-test', aliases: [], summary: 's', severity: sev, cvss: null,
  published: published ?? null, fixed_in: null, url: 'u', vulnerable_range: 'r',
});

describe('exposure-days', () => {
  it('accrues from max(introduction, disclosure)', () => {
    const intro = new Date('2024-01-01T00:00:00Z');   // introduced 2y before now
    const disclosed = new Date('2025-01-01T00:00:00Z'); // disclosed 1y before now
    const { total } = exposureForVulns({
      vulns: [vuln('high', disclosed.toISOString())],
      introducedAt: intro, now: NOW,
    });
    // start = disclosure (later of the two) → 365 days × weight 0.7 = 255.5
    expect(total).toBeCloseTo(0.7 * 365, 1);
  });

  it('exposure cannot predate the introduction commit', () => {
    const intro = new Date('2025-07-01T00:00:00Z');    // 6 months before now
    const disclosed = new Date('2020-01-01T00:00:00Z'); // ancient advisory
    const { total } = exposureForVulns({
      vulns: [vuln('critical', disclosed.toISOString())],
      introducedAt: intro, now: NOW,
    });
    expect(total).toBeCloseTo(1.5 * 184, 0); // ~184 days × 1.5
  });

  it('sums across vulnerabilities and weights severities', () => {
    const intro = new Date('2025-01-01T00:00:00Z');
    const { total, perVuln } = exposureForVulns({
      vulns: [vuln('critical'), vuln('low')],
      introducedAt: intro, now: NOW,
    });
    expect(perVuln.length).toBe(2);
    expect(total).toBeCloseTo(1.5 * 365 + 0.1 * 365, 0);
  });

  it('zero exposure without introduction or disclosure date', () => {
    const { total } = exposureForVulns({ vulns: [vuln('high')], introducedAt: null, now: NOW });
    expect(total).toBe(0);
  });
});

describe('risk index', () => {
  it('is bounded to [0,100] and monotonic in exposure', () => {
    const lo = riskIndex({ exposureDays: 10, deprecated: false, staleDays: null, reviewed: null, usageFileCount: 0 });
    const hi = riskIndex({ exposureDays: 5000, deprecated: true, staleDays: 3000, reviewed: false, usageFileCount: 50 });
    expect(lo.risk).toBeGreaterThanOrEqual(0);
    expect(hi.risk).toBeLessThanOrEqual(100);
    expect(hi.risk).toBeGreaterThan(lo.risk);

    const mid = riskIndex({ exposureDays: 800, deprecated: false, staleDays: null, reviewed: null, usageFileCount: 0 });
    expect(mid.risk).toBeGreaterThan(lo.risk);
    expect(mid.risk).toBeLessThan(hi.risk);
  });

  it('applies named risk factors', () => {
    const { factors } = riskIndex({ exposureDays: 0, deprecated: true, staleDays: 3000, reviewed: false, usageFileCount: 3 });
    const labels = factors.map((f) => f.label);
    expect(labels.some((l) => l.includes('deprecated'))).toBe(true);
    expect(labels.some((l) => l.includes('behind'))).toBe(true);
    expect(labels.some((l) => l.includes('without review'))).toBe(true);
  });

  it('usage breadth scales risk up', () => {
    const narrow = riskIndex({ exposureDays: 300, deprecated: false, staleDays: null, reviewed: null, usageFileCount: 0 });
    const wide = riskIndex({ exposureDays: 300, deprecated: false, staleDays: null, reviewed: null, usageFileCount: 20 });
    expect(wide.risk).toBeGreaterThan(narrow.risk);
  });
});

describe('repo risk index', () => {
  it('averages dependency risk and totals exposure', () => {
    const { risk, totalExposureDays } = repoRiskIndex([
      { risk: 10, exposureDays: 100 },
      { risk: 30, exposureDays: 400 },
    ]);
    expect(risk).toBe(20);
    expect(totalExposureDays).toBe(500);
  });
});
