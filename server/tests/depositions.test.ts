import { describe, it, expect } from 'vitest';
import { diffSnapshots, diffPair } from '../src/engine/depositions.js';
import type { ManifestSnapshot } from '../src/engine/manifests.js';

function snap(sha: string, at: string, author: string, message: string, deps: Record<string, string | null>): ManifestSnapshot {
  const map = new Map();
  for (const [name, range] of Object.entries(deps)) {
    map.set(name, { name, range, kind: 'prod' as const });
  }
  return { sha, committedAt: at, author, message, ecosystem: 'npm', path: 'package.json', deps: map };
}

describe('diffSnapshots', () => {
  const s1 = snap('aaa', '2023-01-01T00:00:00Z', 'alice', 'init', { express: '^4.0.0', lodash: '^4.17.0' });
  const s2 = snap('bbb', '2023-06-01T00:00:00Z', 'bob', 'add left-pad via PR', { express: '^4.0.0', 'left-pad': '^1.3.0' });
  const s3 = snap('ccc', '2024-01-01T00:00:00Z', 'carol', 'bump express', { express: '^4.18.0', 'left-pad': '^1.3.0' });

  it('derives add/remove/bump events oldest → newest', () => {
    const { events } = diffSnapshots([s1, s2, s3]);
    const kinds = events.map((e) => `${e.kind}:${e.package}`);
    expect(kinds).toContain('remove:lodash');
    expect(kinds).toContain('add:left-pad');
    expect(kinds).toContain('bump:express');
    const bump = events.find((e) => e.kind === 'bump' && e.package === 'express')!;
    expect(bump.fromRange).toBe('^4.0.0');
    expect(bump.toRange).toBe('^4.18.0');
    expect(bump.commitSha).toBe('ccc');
    expect(bump.author).toBe('carol');
  });

  it('carries PR numbers from merge-style messages', () => {
    const merged = snap('ddd', '2024-02-01T00:00:00Z', 'dan', 'Merge pull request #571 from org/feat', { express: '^4.18.0', 'left-pad': '^1.3.0', ms: '^2.1.0' });
    const { events } = diffSnapshots([s3, merged]);
    const add = events.find((e) => e.kind === 'add' && e.package === 'ms')!;
    expect(add.prNumber).toBe(571);
  });

  it('marks deps in the oldest snapshot as predating the window', () => {
    const { introductions } = diffSnapshots([s1, s2, s3]);
    expect(introductions.get('express')!.confidence).toBe('predates-window');
    expect(introductions.get('left-pad')!.confidence).toBe('exact');
    expect(introductions.get('left-pad')!.commitSha).toBe('bbb');
    // express was bumped inside the window, but predates it → introduction stays at window floor
    expect(introductions.get('express')!.at).toBe('2023-01-01T00:00:00Z');
  });

  it('re-introduction after removal resets provenance', () => {
    const a = snap('a1', '2023-01-01T00:00:00Z', 'a', 'x', { lodash: '^4.17.0' });
    const b = snap('b1', '2023-03-01T00:00:00Z', 'b', 'drop lodash', {});
    const c = snap('c1', '2023-09-01T00:00:00Z', 'c', 'restore lodash', { lodash: '^4.17.21' });
    const { introductions } = diffSnapshots([a, b, c]);
    expect(introductions.get('lodash')!.confidence).toBe('exact');
    expect(introductions.get('lodash')!.at).toBe('2023-09-01T00:00:00Z');
  });

  it('diffPair (Sentinel) diffs two arbitrary revisions', () => {
    const events = diffPair(s1, s3);
    expect(events.map((e) => e.kind).sort()).toEqual(['add', 'bump', 'remove']);
  });

  it('empty and single snapshots behave', () => {
    expect(diffSnapshots([]).events.length).toBe(0);
    const { introductions } = diffSnapshots([s1]);
    expect(introductions.size).toBe(2);
  });
});
