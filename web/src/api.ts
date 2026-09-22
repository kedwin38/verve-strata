/** API client: same-origin, session cookie, CSRF header on mutations. */

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' ? { 'x-strata-client': '1' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new ApiError(res.status, data.error ?? 'error', data.message ?? res.statusText);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => call<T>('GET', path),
  post: <T>(path: string, body?: unknown) => call<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => call<T>('PUT', path, body ?? {}),
  del: <T>(path: string) => call<T>('DELETE', path),
};

/* ── shared shapes ─────────────────────────────────────────────────────── */
export interface Me { user: { id: string; email: string }; githubTokenConfigured: boolean }

export interface Analysis {
  id: string; owner: string; repo: string; branch: string | null; ecosystem: string | null;
  status: 'queued' | 'running' | 'complete' | 'failed';
  error: string | null; truncated: boolean; degraded: string[];
  progress: { t: string; phase: string; msg: string }[];
  stats: Record<string, number>;
  created_at: string; completed_at: string | null;
}

export interface Stratum {
  id: number; name: string; ecosystem: string; dep_kind: string;
  constraint_range: string | null; resolved_version: string | null;
  introduced_at: string | null; introduced_commit: string | null;
  introduced_pr: number | null; introduced_author: string | null;
  reviewed: boolean | null; introduction_confidence: string;
  latest_version: string | null; latest_published_at: string | null;
  deprecated: boolean; usage_files: string[]; usage_sampled: number;
  vulns: { id: string; severity: string; summary: string; fixed_in: string | null; url: string }[];
  exposure_days: string; risk: string; risk_factors: { label: string; contribution: number }[];
}

export interface DepositionEvent {
  id: number; committed_at: string; kind: 'add' | 'remove' | 'bump';
  package: string; ecosystem: string; from_range: string | null; to_range: string | null;
  commit_sha: string; pr_number: number | null; author: string | null;
}

export interface Finding {
  id: string; analysis_id: string; kind: string; package: string; severity: string;
  title: string; detail: Record<string, any>; exposure_days: string;
  investigation_id: string | null;
}

export interface ChainNode {
  id: string; type: string; label: string;
  detail?: Record<string, any>;
  evidence: { source: string; url?: string; fetchedAt: string; digest: string }[];
}

export interface Investigation {
  id: string; finding_id: string; status: string; confidence: number;
  chain: { nodes: ChainNode[]; edges: { from: string; to: string; relation: string }[] };
  tool_trace: { tool: string; input: Record<string, any>; ok: boolean; ms: number; note?: string }[];
  recommendation: {
    action: string; urgency: string; target: string | null;
    rationale: string;
    patch: { path: string; from: string; to: string } | null;
    rollbackNote: string | null; requiresApproval: boolean;
  };
}

export interface SentinelResult {
  pr: { number: number; title: string; approvals: number; reviews: number; author: string; url: string };
  verdict: 'block' | 'warn' | 'pass' | 'neutral';
  delta: {
    package: string; change: string; toRange: string | null; resolved: string | null;
    vulns: { id: string; severity: string; summary: string }[]; deprecated: boolean;
  }[];
  retired: { package: string; vulns: number }[];
  rationale: string;
}
