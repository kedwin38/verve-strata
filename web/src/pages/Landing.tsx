import React from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '../App.js';

export default function Landing() {
  return (
    <div>
      <nav className="nav">
        <div className="shell nav-inner">
          <span className="nav-brand">
            <Logo />
            <span className="wordmark">VERVE <em>STRATA</em></span>
          </span>
          <div className="nav-links">
            <a href="#thesis">Thesis</a>
            <a href="#method">Method</a>
            <a href="#category">Category</a>
          </div>
          <div className="nav-spacer" />
          <Link to="/login" className="btn">Sign in</Link>
          <Link to="/register" className="btn primary">Run first stratigraphy</Link>
        </div>
      </nav>

      <div className="shell">
        <header className="hero">
          <div className="kicker">Dependency Provenance Intelligence · Verve Enterprises</div>
          <h1>Every dependency in your codebase was a <em>decision</em>. Strata finds the receipt.</h1>
          <p className="thesis">
            Scanners tell you what you have. Reachability tools tell you where a vulnerability is callable.
            Neither tells you <strong>when a risky dependency entered, who introduced it, through which PR,
            whether it was reviewed, or how long it has been accruing exposure</strong>. Strata reads your
            repository's dependency history the way a geologist reads strata — and gates the next merge.
          </p>
          <div className="cta-row">
            <Link to="/register" className="btn primary">Analyze a repository →</Link>
            <span className="dim small">works on any public GitHub repo · npm &amp; PyPI · OSV.dev intelligence</span>
          </div>
        </header>

        <section className="section" id="category">
          <div className="kicker">The category we are inventing</div>
          <h2>Supply-chain tools answer WHERE. Strata answers WHEN, WHO, and HOW LONG.</h2>
          <p className="lede">
            Software composition analysis built an inventory. Reachability analysis built a map.
            Provenance intelligence builds a <strong>timeline with accountability</strong> — and turns
            it into decisions.
          </p>
          <div className="grid-3">
            <div className="card">
              <div className="tag">SCA / SBOM</div>
              <h3>Inventory tools</h3>
              <p>Dependabot, OWASP dependency-check, Grype: enumerate what you ship and match it against advisories. A snapshot. No memory of how you got here.</p>
            </div>
            <div className="card">
              <div className="tag">REACHABILITY</div>
              <h3>Spatial tools</h3>
              <p>Snyk reachability, Endor Labs: whether your call graph reaches a vulnerable function. Powerful — but silent on provenance, review state, and exposure time.</p>
            </div>
            <div className="card" style={{ borderColor: 'var(--sand-dim)' }}>
              <div className="tag" style={{ color: 'var(--sand)' }}>STRATIGRAPHY — NEW</div>
              <h3>Verve Strata</h3>
              <p>Temporal provenance: every dependency dated to its introducing commit, PR, and author; exposure-days anchored at introduction; pre-merge gating for the next deposition.</p>
            </div>
          </div>
        </section>

        <section className="section" id="method">
          <div className="kicker">Method</div>
          <h2>Excavate → Correlate → Weigh → Gate → Remediate</h2>
          <div className="grid-3">
            <div className="card">
              <div className="tag">01 · EXCAVATE</div>
              <h3>Manifest archaeology</h3>
              <p>Strata walks every revision of your package.json / requirements.txt in git history and reconstructs the dependency snapshot at each — the sediment, layer by layer.</p>
            </div>
            <div className="card">
              <div className="tag">02 · CORRELATE</div>
              <h3>Live intelligence join</h3>
              <p>Each layer is joined against the npm/PyPI registry and OSV.dev advisories, resolved through your lockfile when one exists. Every claim carries a source.</p>
            </div>
            <div className="card">
              <div className="tag">03 · WEIGH</div>
              <h3>Exposure-days</h3>
              <p>A vulnerability accrues severity-weighted days from max(introduction, disclosure). 400 days of a critical advisory is a number no dashboard gives you — and no manager can misread.</p>
            </div>
            <div className="card">
              <div className="tag">04 · GATE</div>
              <h3>Sentinel (pre-merge)</h3>
              <p>Point Sentinel at a pull request: it diffs the manifests at base and head, and returns a verdict — block, warn, pass — plus the exposure the PR would retire by removing vulnerable deps.</p>
            </div>
            <div className="card">
              <div className="tag">05 · REMEDIATE</div>
              <h3>Evidence-bound agent</h3>
              <p>The forensic reasoner assembles the causal chain — advisory, introduction commit, review state, usage, fix — with per-node evidence and computed confidence. It cannot hallucinate; it can only be incomplete.</p>
            </div>
            <div className="card">
              <div className="tag">06 · VERIFY</div>
              <h3>Approval-gated action</h3>
              <p>Remediation opens a real pull request — only with your own stored GitHub token, only on your explicit click, every attempt audited. No silent writes, ever.</p>
            </div>
          </div>
        </section>

        <section className="section" id="thesis">
          <div className="kicker">Why temporal changes everything</div>
          <h2>"You have a critical vulnerability" is an alarm. "Dana merged it unreviewed in PR #2141 fourteen months ago, four files call it, and the fix shipped last Tuesday" is a decision.</h2>
          <p className="lede">
            The first sentence creates a ticket. The second one ends an argument: what to patch first, who
            to involve, whether the next upgrade needs review, and whether the process that let it in is
            still running. That second sentence is Strata's entire product.
          </p>
          <div className="stat-row">
            <div className="stat sand"><div className="v mono">exposure-days</div><div className="l">the unit of supply-chain debt</div></div>
            <div className="stat"><div className="v mono">deposition events</div><div className="l">every add / bump / remove, dated</div></div>
            <div className="stat"><div className="v mono">evidence chains</div><div className="l">conclusions that cite their sources</div></div>
          </div>
        </section>
      </div>

      <footer className="footer">
        <div className="shell cols">
          <div>
            <div className="nav-brand" style={{ marginBottom: 8 }}>
              <Logo size={16} />
              <span className="wordmark small">VERVE <em>STRATA</em></span>
            </div>
            <div>Dependency Provenance Intelligence</div>
            <div className="faint">A Verve Enterprises frontier technology product.</div>
          </div>
          <div>
            <div className="mono small dim">DATA SOURCES</div>
            <div className="small faint">GitHub REST API · npm registry · PyPI JSON API · Google OSV.dev<br />All findings derived live from these sources — nothing simulated.</div>
          </div>
          <div>
            <div className="mono small dim">SECURITY POSTURE</div>
            <div className="small faint">scrypt password hashing · hashed session tokens · AES-256-GCM token storage<br />CSRF header gating · per-route rate limits · append-only audit log</div>
          </div>
        </div>
      </footer>
    </div>
  );
}
