# Verve Strata — Architecture

## System overview

One deployable service (Fastify 5, TypeScript, ESM, Node 20) + PostgreSQL. The SPA is built in
the Docker image and served by the same process. There is no worker process yet by design: the
engine is async-in-process with DB-backed job rows (`analyses.status` + `progress`), which makes
a later split to a dedicated worker a deployment change, not a code change.

## Modules

### `server/src/services` — upstream clients
- **httpfetch** — `cachedFetch` with a Postgres-backed cache (`fetch_cache`), ETag
  revalidation, timeouts, and bounded concurrency (`mapLimit`). This is the piece that makes
  the product viable against unauthenticated GitHub rate limits (60 req/h): a full analysis is
  ~depth+deps+sample API calls, and every repeat is free.
- **github** — repo metadata, per-path commit walk, file contents at ref, recursive tree, PR
  metadata incl. review counts, merge-message PR extraction.
- **registry** — npm registry document and PyPI JSON normalization to a common
  `RegistryMeta` (versions, publish times, deprecation, latest).
- **osv** — query by ecosystem+name+version; normalization (severity classes, CVSS parsing,
  smallest `fixed` above the resolved version).

### `server/src/engine` — the stratigraphy core
- **manifests** — `package.json` / `requirements.txt` → normalized snapshots; lockfile pin
  extraction (v1–v3).
- **depositions** — consecutive-snapshot diffing → `add`/`bump`/`remove` events; introduction
  resolution with confidence labels (`exact`, `predates-window`); re-introduction resets
  provenance; `diffPair` for Sentinel.
- **imports** — conservative import/require scan, source-file triage, entrypoint-first
  sampling priority.
- **scoring** — exposure-days and the risk index. Pure functions, fully tested.
- **runner** — orchestration: claim job row → walk history → snapshot per revision → diff →
  lockfile/range resolution → registry+OSV join (mapLimit 4) → usage sample → review-state
  lookup (bounded, only where it changes decisions) → persist records, events, findings,
  stats. Per-dependency failures are recorded to `degraded` and the run continues.

### `server/src/agent` — the forensic reasoner
Fixed plan: locate → contextualize (PR review state) → weigh (usage) → solve (upgrade target
from fixed-in + registry versions) → verify (target published) → recommend. Emits a chain of
typed nodes, each with evidence refs (source, URL, fetch time, payload digest); edges carry
relations. Confidence is computed: base 0.5, +0.2 exact introduction, +0.1 PR fetched,
+0.1 usage observed, +0.1 target verified, capped 0.95. The remediation apply path is a
separate, approval-gated route that performs real GitHub writes (branch → commit → PR) with
the user's stored token only.

### `server/src/http` — the surface
Session plugin (opaque cookie → SHA-256 hashed server rows), CSRF header gate on mutations,
token-bucket rate limits per route class, audit helper, route modules (auth, analyses,
investigations, sentinel, settings), static SPA serving with fallback, `/healthz` (DB check).

## Data model (migrations/001_init.sql)

`users`, `sessions`, `gh_tokens` (encrypted), `analyses` (job + progress + stats),
`strata_records` (per current dependency: identity, provenance, registry state, usage, risk),
`deposition_events` (the timeline), `findings`, `investigations` (chains + tool traces),
`audit_log`, `fetch_cache`.

## Scaling notes

- The fetch cache is the shared memory of the system; it makes concurrent analyses of the
  same repo nearly free and is trivially evictable by age.
- The engine's bounded-concurrency design (caps + mapLimit) is intentionally polite to
  upstreams; a worker split would reuse `runAnalysis` unchanged.
- Everything the UI renders is derived from `strata_records`/`findings` rows — reports are
  reproducible from the database alone.
