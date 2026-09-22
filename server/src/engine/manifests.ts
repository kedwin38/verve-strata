/**
 * Manifest parsing: turn package.json / requirements.txt contents at a given
 * revision into a normalized dependency snapshot (name → {range, kind}).
 */

export interface DepEntry {
  name: string;
  range: string | null;
  kind: 'prod' | 'dev';
}

export interface ManifestSnapshot {
  sha: string;
  committedAt: string;
  author: string;
  message: string;
  ecosystem: 'npm' | 'pypi';
  path: string;
  deps: Map<string, DepEntry>;
}

export interface ParsedPackageJson {
  deps: Map<string, DepEntry>;
  ecosystem: 'npm';
}

export function parsePackageJson(text: string): ParsedPackageJson | null {
  let doc: any;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof doc !== 'object' || doc === null) return null;
  const deps = new Map<string, DepEntry>();
  const collect = (obj: any, kind: 'prod' | 'dev') => {
    if (typeof obj !== 'object' || obj === null) return;
    for (const [name, range] of Object.entries(obj)) {
      if (typeof range !== 'string') continue;
      deps.set(name, { name, range, kind });
    }
  };
  collect(doc.dependencies, 'prod');
  collect(doc.optionalDependencies, 'prod');
  collect(doc.peerDependencies, 'dev');
  collect(doc.devDependencies, 'dev');
  return { deps, ecosystem: 'npm' };
}

/**
 * requirements.txt: supports `name==1.2.3`, `name>=1,<2`, `name~=1.2`,
 * bare `name`, inline comments, `#` lines, `-r`/`--` option lines ignored.
 */
export function parseRequirementsTxt(text: string): Map<string, DepEntry> {
  const deps = new Map<string, DepEntry>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split('#')[0].trim();
    if (!line || line.startsWith('-')) continue;
    const m = line.match(/^([A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?)(\s*(\[[^]]*\])?\s*(.*))?$/);
    if (!m) continue;
    const rawName = m[1];
    const spec = (m[5] ?? '').trim();
    const name = rawName.toLowerCase().replace(/-/g, '_');
    const range = spec === '' ? null : spec.replace(/\s+/g, ' ');
    deps.set(name, { name, range, kind: 'prod' });
  }
  return deps;
}

export function detectManifestKind(path: string): 'npm' | 'pypi' | null {
  if (path === 'package.json' || path.endsWith('/package.json')) return 'npm';
  if (path === 'requirements.txt' || path.endsWith('/requirements.txt')) return 'pypi';
  return null;
}

/** Parse a package-lock.json (v2/v3) or yarn-lock-free npm lockfile for exact pins. */
export function parsePackageLock(text: string): Map<string, string> {
  const pins = new Map<string, string>();
  try {
    const doc = JSON.parse(text);
    // lockfile v2/v3: packages["node_modules/x"].version ; v1: dependencies map
    if (doc.packages && typeof doc.packages === 'object') {
      for (const [p, meta] of Object.entries<any>(doc.packages)) {
        if (p === '' || !meta?.version) continue;
        const name = p.replace(/^node_modules\//, '').replace(/.*node_modules\//, '');
        if (name && !name.includes('/') || name.startsWith('@')) {
          pins.set(name, meta.version);
        }
      }
    }
    if (doc.dependencies && typeof doc.dependencies === 'object') {
      for (const [name, meta] of Object.entries<any>(doc.dependencies)) {
        if (meta?.version && !pins.has(name)) pins.set(name, meta.version);
      }
    }
  } catch {
    /* unparsable lockfile → no pins, engine falls back to range resolution */
  }
  return pins;
}
