# Verve Strata — Security Model

Security here is architecture, not decoration. The product reads repositories and can, under
explicit user authorization, write to them — so the boundaries are drawn conservatively.

## Authentication & sessions
- Passwords: scrypt (N=16384, r=8, p=1) with per-user 16-byte salt; constant-time verify.
- Sessions: 32-byte random opaque tokens; **only the SHA-256 hash is stored**; 7-day expiry;
  server-side revocation (row delete).
- Cookies: `HttpOnly`, `SameSite=Strict`, `Secure` in production.

## CSRF
All mutating API calls require the `x-strata-client: 1` header, which cross-site form posts
cannot set, layered on `SameSite=Strict` cookies. Rejected requests get an explanatory 403.

## Authorization & tenancy
Every analysis-scoped query filters by `user_id`; findings, investigations, and strata records
are reachable only through their owning analysis. The remediation apply path re-verifies both
the investigation owner and the finding lineage before any external write.

## Secrets
- User GitHub PATs: validated against GitHub, then stored **AES-256-GCM encrypted** with a key
  that exists only in the server environment (`TOKEN_ENC_KEY`). No endpoint ever returns them.
  If the key is absent the server *refuses to store tokens at all* rather than degrade to
  plaintext. Removal is a row delete.
- Server configuration via environment variables only (Railway variables in production).
  `.env.example` documents the surface; `.gitignore` excludes real values.

## Agent containment (the important part)
- The forensic reasoner has **no ambient credentials and no write tools**. It reads typed tool
  outputs (DB rows, upstream JSON) and emits recommendations.
- The only write path to the outside world is `POST /investigations/:id/apply`: requires
  (1) an explicit user click, (2) a stored user-scoped token, (3) a recommendation that
  carries a manifest patch. Rate-limited to 3/hour. Every attempt — success, denial, or
  GitHub rejection — is audited with user, target, and metadata.
- Upstream repository content is **data, not instructions**: manifests are parsed, never
  evaluated; the reasoner consumes typed structures, not free text — there is no prompt to
  inject into. A malicious `package.json` can at worst be malformed.

## Input validation & injection resistance
zod schemas validate every request body with tight shapes (`owner/repo` regexes, bounded
integers). All database access is parameterized SQL via `pg`. No dynamic SQL string building
anywhere. Response bodies are JSON; the SPA renders React (escaped by default); the API sets
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.

## Rate limiting & abuse
Token buckets per IP: global 240/min, auth 10/15min, analysis launches 6/h, sentinel 12/h,
investigations 20/h, remediation 3/h. 429s carry `Retry-After`. Upstream calls run with
bounded concurrency, timeouts, and a shared cache — Strata cannot be used to hammer GitHub.

## Audit
Append-only `audit_log`: registrations, logins (incl. failures), token storage/removal,
analysis creation, investigation runs, sentinel previews, remediation attempts with outcomes.

## Known gaps (honest)
- No email verification / password reset (MVP scope).
- Single-region, single-instance rate limiting (in-memory buckets).
- Usage scanning is sampled, not exhaustive (stated in-product).
