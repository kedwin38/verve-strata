-- Verve Strata — initial schema.
-- Domain: users/sessions, encrypted GitHub PATs, stratigraphy analyses,
-- deposition events, per-dependency strata records, findings, forensic
-- investigations, audit log, and an HTTP fetch cache for upstream APIs.

create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  user_agent text
);

-- User-scoped GitHub PAT, encrypted at rest with AES-256-GCM using a key
-- held only in server environment (TOKEN_ENC_KEY). Plaintext never persisted.
create table if not exists gh_tokens (
  user_id uuid primary key references users(id) on delete cascade,
  ciphertext text not null,
  nonce text not null,
  created_at timestamptz not null default now()
);

create table if not exists analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  owner text not null,
  repo text not null,
  branch text,
  ecosystem text,
  status text not null default 'queued',      -- queued | running | complete | failed
  error text,
  truncated boolean not null default false,   -- history deeper than analysis window
  degraded jsonb not null default '[]',       -- recorded upstream failures
  progress jsonb not null default '[]',       -- [{t, phase, msg}]
  stats jsonb not null default '{}',
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- One row per current direct dependency: its identity, its provenance
-- (introduction commit/PR/author), live registry state, usage, and risk.
create table if not exists strata_records (
  id bigserial primary key,
  analysis_id uuid not null references analyses(id) on delete cascade,
  name text not null,
  ecosystem text not null,                    -- npm | pypi
  dep_kind text not null,                     -- prod | dev
  constraint_range text,
  resolved_version text,
  introduced_at timestamptz,
  introduced_commit text,
  introduced_pr integer,
  introduced_author text,
  reviewed boolean,
  introduction_confidence text not null default 'unknown', -- exact | window | predates-window | unknown
  latest_version text,
  latest_published_at timestamptz,
  deprecated boolean not null default false,
  usage_files jsonb not null default '[]',
  usage_sampled integer not null default 0,
  vulns jsonb not null default '[]',
  exposure_days numeric not null default 0,
  risk numeric not null default 0,
  risk_factors jsonb not null default '[]'
);
create index if not exists strata_records_analysis_idx on strata_records(analysis_id);

-- Every change to a dependency manifest observed in the analysis window:
-- the depositional record of the repository.
create table if not exists deposition_events (
  id bigserial primary key,
  analysis_id uuid not null references analyses(id) on delete cascade,
  committed_at timestamptz not null,
  kind text not null,                         -- add | remove | bump
  package text not null,
  ecosystem text not null,
  from_range text,
  to_range text,
  commit_sha text not null,
  pr_number integer,
  author text,
  reviewed boolean
);
create index if not exists deposition_events_analysis_idx on deposition_events(analysis_id);

create table if not exists findings (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references analyses(id) on delete cascade,
  kind text not null,                         -- vuln | deprecated | stale | unreviewed
  package text not null,
  severity text not null,                     -- critical | high | moderate | low | info
  title text not null,
  detail jsonb not null default '{}',
  exposure_days numeric not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists findings_analysis_idx on findings(analysis_id);

-- Output of the deterministic forensic reasoner: causal chain, tool trace,
-- confidence, and a recommendation. Every node cites evidence.
create table if not exists investigations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  finding_id uuid not null references findings(id) on delete cascade,
  status text not null default 'complete',
  confidence numeric not null default 0,
  chain jsonb not null default '{}',
  tool_trace jsonb not null default '[]',
  recommendation jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists audit_log (
  id bigserial primary key,
  user_id uuid,
  action text not null,
  target text,
  meta jsonb not null default '{}',
  ip text,
  created_at timestamptz not null default now()
);

-- Shared HTTP cache for upstream APIs (GitHub, npm, PyPI, OSV). Makes repeat
-- analyses cheap and keeps us inside unauthenticated rate limits.
create table if not exists fetch_cache (
  url text primary key,
  etag text,
  status integer not null,
  body text not null,
  fetched_at timestamptz not null default now()
);
