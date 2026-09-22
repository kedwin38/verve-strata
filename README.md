# Verve Strata

**Dependency Provenance Intelligence** — a Verve Enterprises frontier technology product.

> Scanners tell you *what* you have. Reachability tools tell you *where* a vulnerability is callable.
> **Strata tells you when each dependency entered your codebase, who introduced it, through which PR,
> whether it was reviewed, how long it has been accruing exposure — and what the next merge would deposit.**

---

## The category we are inventing: Supply-Chain Stratigraphy

Every dependency in your repository arrived through a decision — a commit, usually a pull request,
sometimes reviewed, often not. Existing tooling treats your dependency list as a *snapshot*:

| Generation | Question answered | Examples |
|---|---|---|
| SCA / SBOM | *What do we ship?* | Dependabot, OWASP dependency-check, Grype |
| Reachability | *Where is a vulnerability callable?* | Snyk reachability, Endor Labs |
| **Strata (this repo)** | **When did it enter? Who decided? How long have we been exposed? Should the next merge be allowed?** | — |

The unit Strata contributes to the discipline is the **exposure-day**:

```
exposure-days(v) = W(severity_v) × days( now − max( introduced(dep), published(v) ) )
W = { critical: 1.5, high: 0.7, moderate: 0.3, low: 0.1 }
```

A vulnerability cannot accrue exposure before it was disclosed, nor before the dependency carrying
it entered the codebase. Four hundred exposure-days on a critical advisory is a number nobody has
to interpret — and it is anchored to a *specific commit and PR you can open*, not to when a scanner
first happened to look.

## How it works — the intelligence loop

**Excavate → Correlate → Weigh → Gate → Remediate → Verify**

1. **Excavate (manifest archaeology).** For any public GitHub repository, Strata walks every commit
   that touched the root `package.json` (or `requirements.txt`) within a depth-capped window and
   reconstructs the dependency snapshot at each revision.
2. **Correlate.** Consecutive snapshots are diffed into **deposition events** (`add` / `bump` / `remove`),
   each carrying its commit, date, author, and PR when one exists. Current dependencies are resolved
   to exact versions through the lockfile when present (falling back to today's range resolution —
   the assumption is recorded, never hidden), then joined against the npm/PyPI registry and
   [OSV.dev](https://osv.dev) advisory intelligence. Import usage is sampled across source files
   for blast radius.
3. **Weigh.** Exposure-days per advisory, a bounded, monotonic per-dependency risk index
   (`100·tanh(raw/3)`, see `server/src/engine/scoring.ts`), and a repository-level rollup.
4. **Gate (Sentinel).** Point it at a pull request: it reconstructs the manifest at base and head,
   diffs them, and returns a **block / warn / pass verdict** with the advisories the merge would
   begin accruing — and the exposure it *retires* by removing vulnerable dependencies.
5. **Remediate (the forensic reasoner).** A deterministic, evidence-bound agent assembles the causal
   chain — advisory → introduction commit → review state → usage → fixed-in version → upgrade
   target — and computes confidence from evidence completeness. **It cannot hallucinate: every node
   cites its evidence (source URL, fetch time, payload digest); it can only be incomplete.**
6. **Verify.** Remediation that requires a manifest change can be applied as a *real* pull request —
   only with the user's own stored token, only on explicit click, every attempt audited.

## Architecture

```
┌────────────────────────── Railway (single service + PostgreSQL) ─────────────────────────┐
│                                                                                          │
│  web/dist (React SPA, built in Docker)                                                   │
│      │ served by                                                                         │
│  Fastify 5 (TypeScript, ESM)  ── /api/v1 ──┐                                             │
│   ├─ auth (scrypt, hashed session tokens, SameSite=Strict + CSRF header gate)             │
│   ├─ analyses (async stratigraphy runner, DB-backed job rows, progress log)               │
│   ├─ findings / investigations (forensic reasoner, evidence chains)                       │
│   ├─ sentinel (pre-merge gate)                                                            │
│   ├─ settings (AES-256-GCM encrypted GitHub PATs)                                        │
│   └─ /healthz                                                                             │
│      │                                                                                    │
│  PostgreSQL ── users, sessions, gh_tokens, analyses, strata_records,                      │
│      deposition_events, findings, investigations, audit_log, fetch_cache                  │
│                                                                                          │
└────────┬──────────────┬───────────────┬──────────────────┬───────────────────────────────┘
         │ GitHub REST  │ npm registry  │ PyPI JSON API    │ OSV.dev API
         │ (commits,    │ (versions,    │ (releases,       │ (advisories,
         │  contents,   │  deprecation, │  upload dates)   │  CVSS, fixed-in)
         │  PRs)        │  publish)     │                  │
```

Key engineering decisions:

- **DB-backed conditional HTTP cache** (`fetch_cache` with ETag revalidation) — repeat analyses cost
  upstreams almost nothing and keep Strata viable inside unauthenticated GitHub rate limits.
- **Degraded-but-honest runs**: upstream failures are recorded per-dependency and surfaced in the
  UI (`degraded`), never silently dropped.
- **Bounded async engine**: depth caps, import-sample caps, bounded-concurrency fetches (`mapLimit`),
  review-state lookups only where they change decisions (vulnerable deps).
- **No LLM in the reasoning path.** For a security product, "confidently wrong" is the failure mode
  that matters. The reasoner is a fixed plan of typed tool calls with per-node evidence and computed
  confidence — an agent you can audit.

## Repository layout

```
server/               Fastify API + engine + reasoner (TypeScript, ESM)
  src/config.ts       zod-validated environment
  src/db.ts           pg pool + transactional migration runner
  src/crypto.ts       scrypt passwords, session hashing, AES-256-GCM secret box
  src/services/       GitHub / registry / OSV clients, cached conditional fetch
  src/engine/         manifests, deposition diffing, import scan, scoring, runner
  src/agent/          forensic reasoner (evidence chains, recommendations)
  src/http/           app assembly, sessions, rate limits, routes
  migrations/         SQL schema
  tests/              vitest suite (38 tests)
web/                  React 18 + Vite SPA — core-sample timeline, evidence chains
Dockerfile            multi-stage production image (build web + server, runtime deps only)
railway.json          Railway deploy config (healthcheck, restart policy)
docs/                 ARCHITECTURE.md · BRAND.md · SECURITY.md
```

## Local development

```bash
# prerequisites: Node ≥ 20, PostgreSQL
createdb strata
cp .env.example .env         # fill DATABASE_URL, SESSION_SECRET, TOKEN_ENC_KEY
npm install
npm run dev:server           # API on :8080 (tsx watch)
npm run dev:web              # SPA on :5173 (proxies /api)
npm test                     # 38 vitest tests
```

## Environment variables

See [`.env.example`](.env.example). Required: `DATABASE_URL`, `SESSION_SECRET` (≥16 chars),
`TOKEN_ENC_KEY` (64 hex chars — only needed for the optional PAT storage feature).
Optional: `GITHUB_TOKEN` (server-level rate-limit headroom), `STRATA_MAX_DEPTH`,
`STRATA_IMPORT_SAMPLE`, `PORT`, `LOG_LEVEL`.

## Deployment (Railway)

1. Create a project, add the **PostgreSQL** template.
2. Deploy this repository (Dockerfile detected automatically).
3. Set service variables: `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`, `SESSION_SECRET`,
   `TOKEN_ENC_KEY` (generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`),
   `NODE_ENV=production`, `PORT=8080`.
4. Generate a domain targeting port 8080. Health: `GET /healthz` (checks DB).
Migrations apply automatically on boot.

## Security model

Read [`docs/SECURITY.md`](docs/SECURITY.md). Summary: scrypt password hashing; opaque session
tokens stored only as SHA-256 hashes; `SameSite=Strict` cookies + custom-header CSRF gate on all
mutations; per-route token-bucket rate limits; AES-256-GCM encryption at rest for user GitHub
PATs (server refuses to store them if the key is absent); append-only audit log; the remediation
agent has **no** ambient credentials — it acts only with user-scoped tokens on explicit approval,
and every attempt is audited. Upstream content is treated as untrusted data (parsed, never
evaluated); the reasoner consumes typed tool outputs, not free text, closing the prompt-injection
surface by construction.

## Honest limitations

- Depth-capped history (default 60 manifest revisions); older introductions are marked
  `predates-window` rather than guessed.
- Usage is an import-reference scan over a sampled file set — breadth, not a call graph.
- Exact version resolution prefers the lockfile; without one, "today's range resolution" stands in
  and is labeled as such in every output.
- Python support covers pinned/ranged `requirements.txt` (no poetry/pipfile yet).
- Single-service architecture; the engine runs in-process (DB-backed job rows make a worker split
  straightforward when needed).
- Review-state lookups are bounded to vulnerable dependencies (API spend).

## License

MIT © Verve Enterprises.
