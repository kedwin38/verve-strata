/**
 * Usage breadth: which source files reference each dependency. A conservative
 * import/require scan — deliberately not a call graph. Sampled, capped, and
 * honest about its coverage in the analysis output.
 */

export interface UsageResult {
  /** package name → file paths that reference it */
  usage: Map<string, string[]>;
  sampled: number;
  totalCandidates: number;
}

const JS_IMPORT = /(?:import\s+[^'"]*?from\s*|require\s*\(\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;
const PY_IMPORT = /^\s*(?:from\s+([A-Za-z0-9_.]+)\s+import|import\s+([A-Za-z0-9_.]+))/gm;

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py)$/;

export function isSourceFile(path: string): boolean {
  if (/(^|\/)(node_modules|dist|\.github|coverage|build)\//.test(path)) return false;
  return SOURCE_EXT.test(path) && !/\.(d\.ts|test\.|spec\.|__tests__)/.test(path);
}

/** Extract referenced package names from JS/TS source. */
export function scanJsImports(source: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  JS_IMPORT.lastIndex = 0;
  while ((m = JS_IMPORT.exec(source)) !== null) {
    const spec = m[1];
    if (!spec.startsWith('.') && !spec.startsWith('/') && !spec.startsWith('node:')) {
      out.add(normalizeJsPackage(spec));
    }
  }
  return [...out];
}

/** Extract referenced top-level modules from Python source. */
export function scanPyImports(source: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  PY_IMPORT.lastIndex = 0;
  while ((m = PY_IMPORT.exec(source)) !== null) {
    const mod = (m[1] ?? m[2] ?? '').split('.')[0];
    if (mod) out.add(mod.toLowerCase().replace(/-/g, '_'));
  }
  return [...out];
}

export function normalizeJsPackage(spec: string): string {
  const parts = spec.split('/');
  if (spec.startsWith('@')) return parts.slice(0, 2).join('/');
  return parts[0];
}

/**
 * Prioritize which files to sample when we must cap blob fetches:
 * entrypoints first (main/index/server/app), then larger files.
 */
export function prioritizeFiles(paths: string[], cap: number): string[] {
  const scored = paths.map((p) => {
    const base = p.split('/').pop() ?? p;
    let score = 0;
    if (/^(main|index|server|app|cli)\.[a-z]+$/.test(base)) score += 100;
    if (p.split('/').length <= 2) score += 40; // near root
    if (p.includes('src/')) score += 20;
    return { p, score };
  });
  scored.sort((a, b) => b.score - a.score || a.p.localeCompare(b.p));
  return scored.slice(0, cap).map((s) => s.p);
}
