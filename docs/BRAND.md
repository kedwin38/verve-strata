# Verve Strata — Brand System

## Name & rationale
**Verve Strata** (Verve Enterprises product family).
*Strata* — the layers of sedimentary rock geologists read to reconstruct deep history. The
product does exactly this to dependency manifests: each `npm install` decision deposits a
layer; Strata performs **supply-chain stratigraphy**. The word is technically literate
(geology, archaeology), short, pronounceable, and unclaimed in the dev-tool space.

## Positioning
**Category:** Dependency Provenance Intelligence (we are inventing it).
**Enemy:** the snapshot. Tools that see only *what is* cannot explain *how it got here* or
*what it costs over time*.
**Promise:** every dependency is a decision — Strata finds the receipt, prices the exposure,
and gates the next one.

## Mission / vision
- **Mission:** give engineering teams temporal accountability for their supply chain —
  who introduced what, when, reviewed or not, and at what accumulating cost.
- **Vision:** provenance becomes a first-class CI gate; "exposure-days" joins MTTR and DORA
  as a metric serious teams report.

## Voice
Technical, precise, restrained, quietly confident. Geological metaphor used sparingly and
correctly (core sample, deposition, stratum, unconformity). Never: hype adjectives, robot
imagery, "AI-powered" as a selling prefix. Numbers over adjectives. Evidence over claims.

## Terminology (product language)
| Term | Meaning |
|---|---|
| Core / extraction | One full analysis of a repository |
| Deposition event | An add/bump/remove of a dependency, dated to its commit |
| Stratum record | One current dependency with provenance + live intelligence |
| Exposure-days | Severity-weighted days since max(introduction, disclosure) |
| Sentinel | The pre-merge gate |
| Forensic reasoner | The deterministic investigation agent |
| Evidence chain | The causal graph with per-node sources & digests |

## Visual language
Deep-basalt dark surface (#0A0E12), single sand accent (#E2B04A — the stratum), data cyan
(#56C8D8), evidence red (#E5484D). Inter for prose; JetBrains Mono for anything
computational (numbers, identifiers, evidence). Flat panels, 1px rules, 4px radii. No
gradients-as-decoration, no glass, no depth illusions: the interface is an instrument, not
a demo. The signature visual is the **core-sample column** — deposition events stacked
oldest-to-newest, vulnerable layers marked in red.

## Iconography & assets
Mark: four horizontal strata bands, one sand. Favicon/App icon: same, on dark tile.
Domain direction: `strata.verveenterprises.com` / `vervestrata.dev`.

## Tagline
**Every dependency was a decision. Strata finds the receipt.**
