/**
 * Deposition diffing: consecutive manifest snapshots → deposition events.
 * This is the stratigraphic core — how the dependency sediment accumulated.
 */
import type { DepEntry, ManifestSnapshot } from './manifests.js';
import { prFromMessage as prFromMsg } from '../services/github.js';

export type EventKind = 'add' | 'remove' | 'bump';

export interface DepositionEvent {
  committedAt: string;
  kind: EventKind;
  package: string;
  ecosystem: 'npm' | 'pypi';
  fromRange: string | null;
  toRange: string | null;
  commitSha: string;
  prNumber: number | null;
  author: string;
}

export interface Introduction {
  at: string;
  commitSha: string;
  prNumber: number | null;
  author: string;
  /** exact = introduced inside the analyzed window; predates-window = older */
  confidence: 'exact' | 'predates-window';
  /** filled later by review-state lookup, when known */
  reviewState?: boolean;
}

/**
 * Diff snapshots (must be ordered oldest → newest) into events, and derive
 * the introduction point of every dependency present in the final snapshot.
 */
export function diffSnapshots(snapshots: ManifestSnapshot[]): {
  events: DepositionEvent[];
  introductions: Map<string, Introduction>;
  truncated: boolean;
} {
  const events: DepositionEvent[] = [];
  const introductions = new Map<string, Introduction>();

  if (snapshots.length === 0) return { events, introductions, truncated: false };

  // Everything present in the oldest observed snapshot predates the window.
  const oldest = snapshots[0];
  for (const name of oldest.deps.keys()) {
    introductions.set(name, {
      at: oldest.committedAt,
      commitSha: oldest.sha,
      prNumber: null,
      author: oldest.author,
      confidence: 'predates-window',
    });
  }

  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1];
    const cur = snapshots[i];
    const emit = (kind: EventKind, name: string, from: DepEntry | undefined, to: DepEntry | undefined) => {
      events.push({
        committedAt: cur.committedAt,
        kind,
        package: name,
        ecosystem: cur.ecosystem,
        fromRange: from?.range ?? null,
        toRange: to?.range ?? null,
        commitSha: cur.sha,
        prNumber: prFromMsg(cur.message),
        author: cur.author,
      });
    };

    const names = new Set([...prev.deps.keys(), ...cur.deps.keys()]);
    for (const name of names) {
      const before = prev.deps.get(name);
      const after = cur.deps.get(name);
      if (!before && after) {
        emit('add', name, undefined, after);
        introductions.set(name, {
          at: cur.committedAt,
          commitSha: cur.sha,
          prNumber: prFromMsg(cur.message),
          author: cur.author,
          confidence: 'exact',
        });
      } else if (before && !after) {
        emit('remove', name, before, undefined);
        introductions.delete(name);
      } else if (before && after && before.range !== after.range) {
        emit('bump', name, before, after);
        // A bump is also a (re)introduction point for the *current* range.
        const intro = introductions.get(name);
        if (intro && intro.confidence === 'exact') {
          introductions.set(name, {
            at: cur.committedAt,
            commitSha: cur.sha,
            prNumber: prFromMsg(cur.message),
            author: cur.author,
            confidence: 'exact',
          });
        }
      }
    }
  }

  return { events, introductions, truncated: false };
}

/** Sentinel diff between two arbitrary snapshots — used by Sentinel (pre-merge). */
export function diffPair(base: ManifestSnapshot, head: ManifestSnapshot): DepositionEvent[] {
  const { events } = diffSnapshots([base, head]);
  return events;
}
