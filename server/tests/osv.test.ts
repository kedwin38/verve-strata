import { describe, it, expect } from 'vitest';
import { severityClass, cvssScore, fixedInFor, mapVuln, compareLoose } from '../src/services/osv.js';
import type { OsvVuln } from '../src/services/osv.js';

const base: OsvVuln = {
  id: 'GHSA-xxxx-yyyy-zzzz',
  summary: 'Prototype pollution in lodash',
  published: '2023-02-01T00:00:00Z',
  affected: [{
    package: { ecosystem: 'npm', name: 'lodash' },
    ranges: [{ type: 'SEMVER', events: [{ introduced: '4.0.0' }, { fixed: '4.17.21' }] }],
    ecosystem_specific: { severity: 'HIGH' },
  }],
};

describe('severity mapping', () => {
  it('prefers GHSA severity labels', () => {
    expect(severityClass(base)).toBe('high');
    expect(severityClass({ ...base, affected: [{ ...base.affected![0]!, ecosystem_specific: { severity: 'CRITICAL' } }] })).toBe('critical');
    expect(severityClass({ ...base, affected: [{ ...base.affected![0]!, ecosystem_specific: { severity: 'LOW' } }] })).toBe('low');
  });

  it('falls back to CVSS score bands', () => {
    const v: OsvVuln = {
      ...base,
      affected: [{ package: { ecosystem: 'npm', name: 'x' }, ranges: [] }],
      severity: [{ type: 'CVSS_V3', score: '9.8' }],
    };
    expect(cvssScore(v)).toBe(9.8);
    expect(severityClass(v)).toBe('critical');
  });

  it('ignores non-numeric CVSS vectors it cannot score', () => {
    const v: OsvVuln = {
      ...base,
      affected: [{ package: { ecosystem: 'npm', name: 'x' }, ranges: [] }],
      severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }],
    };
    expect(cvssScore(v)).toBeNull();
    expect(severityClass(v)).toBe('moderate');
  });

  it('unknown severity is treated as moderate (never silently dropped)', () => {
    const v: OsvVuln = { ...base, affected: [{ package: { ecosystem: 'npm', name: 'x' }, ranges: [] }] };
    expect(severityClass(v)).toBe('moderate');
  });
});

describe('fixed-in resolution', () => {
  it('picks the smallest fixed event above the resolved version', () => {
    const v: OsvVuln = {
      ...base,
      affected: [{
        package: { ecosystem: 'npm', name: 'x' },
        ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '4.17.12' }, { fixed: '4.17.21' }] }],
      }],
    };
    expect(fixedInFor(v, '4.17.15')).toBe('4.17.21');
    expect(fixedInFor(v, '4.16.0')).toBe('4.17.12');
  });

  it('returns null when no fix is published', () => {
    const v: OsvVuln = {
      ...base,
      affected: [{
        package: { ecosystem: 'npm', name: 'x' },
        ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }] }],
      }],
    };
    expect(fixedInFor(v, '1.0.0')).toBeNull();
  });
});

describe('mapVuln', () => {
  it('normalizes an OSV record', () => {
    const m = mapVuln(base, '4.17.15');
    expect(m.id).toBe('GHSA-xxxx-yyyy-zzzz');
    expect(m.severity).toBe('high');
    expect(m.fixed_in).toBe('4.17.21');
    expect(m.url).toContain('osv.dev');
    expect(m.vulnerable_range).toBe('>= 4.0.0 < 4.17.21');
  });
});

describe('compareLoose', () => {
  it('compares dotted versions without semver strictness', () => {
    expect(compareLoose('1.2.3', '1.2.4')).toBeLessThan(0);
    expect(compareLoose('2.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareLoose('1.0.0', '1.0.0')).toBe(0);
  });
});
