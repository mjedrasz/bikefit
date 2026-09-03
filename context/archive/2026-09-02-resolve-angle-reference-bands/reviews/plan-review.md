<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Resolve the Authoritative Gravel Angle Reference Bands

- **Plan**: `context/changes/resolve-angle-reference-bands/plan.md`
- **Mode**: Deep
- **Date**: 2026-09-02
- **Verdict**: REVISE → **SOUND** after triage (all 6 findings fixed 2026-09-02)
- **Findings**: 1 critical, 2 warnings, 3 observations — all FIXED

## Verdicts

| Dimension | Verdict (initial) | Verdict (after fixes) |
|-----------|-----------|-----------|
| End-State Alignment | FAIL | PASS |
| Lean Execution | PASS | PASS |
| Architectural Fitness | PASS | PASS |
| Blind Spots | WARNING | PASS |
| Plan Completeness | WARNING | PASS |

## Triage note (2026-09-02)

F1's premise was **reversed by web research** during triage. The elbow
*included* angle on the hoods is 150–170° across every practitioner reference
checked (BikeFittr printable angle chart; Indoor Cycling Association goniometer
protocol; torger.se; BikeSize; cyclingarchives; Fast Talk Labs); ~90° included
is the TT/aero position. The archived `angle-to-adjustment-guide.md`'s "85–95°
elbow" is a shoulder-angle mislabel (within rounding of the separate
upper-arm-to-torso row, `bike-fitting-ref-angles.md:57`). So the plan's
decision to keep the elbow near 150–160° was correct; the review's Fix A
(reconcile toward 85–95°) would have been a regression. Applied resolution:
band widened to **150–165°** (owner call), rationale re-grounded on the
practitioner evidence, and a note added that this supersedes
`testing-angle-correctness/research.md`'s elbow conclusion.

## Grounding

12/12 paths ✓, 5/5 symbols ✓ (`ANGLE_REFS`, `RECOMMENDATIONS_SYSTEM_PROMPT`, `generateRecommendations`, `angleVerdict`, `buildRecommendationsSystemPrompt`), brief↔plan ✓, baseline `npm test` green (35/35, 3 files). No `research.md` in the change folder — the `/10x-research` handoff prescribed by the rollout chain was skipped. Blast radius confirmed contained: `ANGLE_REFS` is read only by `VideoAnalyzer.tsx` (field-by-field, no spread) + doc comments + the pin test; `RECOMMENDATIONS_SYSTEM_PROMPT` is local to `llm.ts`; `BodyAngle` is a hand-written interface independent of `ANGLE_REFS`'s `as const` type, so adding fields is additive-safe.

## Findings

### F1 — Elbow band kept at 150–160° on a premise the source contradicts

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: End-State Alignment
- **Location**: plan.md:44–46, 96–98, 192–195; plan-brief.md:41; Phase 1 §5 (ANGLE_REFS pin spec)
- **Detail**: The plan justifies keeping `ELBOW` at 150–160° by asserting "the guide's 85–95° is the *upper-arm-to-torso* angle, not the shoulder–elbow–wrist angle the app computes" (plan.md:192–195) and calling the conflict "partly a category error" (plan.md:96). The source contradicts this explicitly. `angle-to-adjustment-guide.md:126`: *"Target (gravel, hoods): 85–95° (included angle at the elbow; 180° = arm fully straight) [2]"*; its Convention note (`:128`) frames 85–95° and 150–160° as the **same measurement** under two conventions — 150–160° "targeting competitive road cyclists (Burt 2014)", 85–95° "a gravel/recreational position where the upper body is more upright". `bike-fitting-ref-angles.md` lists elbow-included 150–160° (cited to a competitive-road source) **and, separately**, upper-arm-to-torso 80–90°; the guide's 85–95° is not that separate row. This project's own prior research already reached the opposite conclusion to the plan: `testing-angle-correctness/research.md:310–343` tabulates the elbow as "largest discrepancy — code took the road/competitive convention" and states the consequence — "a correctly bent, upright-posture elbow (~90°) is scored 'Outside range' and the LLM is told to 'shorten stem by 10 mm increments'." Shipping the plan enshrines the road-racing elbow band for a gravel-only product into an "Authoritative" foundation doc, a pinned unit test citing that doc as oracle, the `change.md` `## Decision` section, and RESOLVED annotations in PRD/roadmap/test-plan — and produces confidently-wrong recommendations, which is Risk #1, the risk the change claims to close. Regardless of which fix is chosen, the "upper-arm-to-torso / category error" claim must be deleted from plan.md, plan-brief.md, and the `reference-angles.md` contract — the two sources genuinely disagree about the elbow and the doc must say so.
- **Fix A ⭐ Recommended**: Reconcile the elbow toward the gravel guide, like the other bands
  - Strength: Consistent with the plan's own stated principle — knee-BDC, knee-TDC and hip are all "reconciled toward the gravel adjustment guide" (plan-brief Key Decisions); applying the same rule to the elbow lands on ~85–95° (or a widened gravel band) and matches the prior research. Removes the bogus "shorten stem" recommendation path.
  - Tradeoff: Large shift from the shipped 150–160°; 85–95° rests on a single non-peer-reviewed practitioner source ([2]); the elbow is measured from the BDC keyframe not cranks-horizontal (accepted deviation, test-plan §7), so elbow uncertainty compounds. Success criterion 2.5, the "Elbow stays 150–160" section, and the retired-range absence list all need updating.
  - Confidence: MED — direction is well-grounded; the exact band is a judgment call the owner should ratify.
  - Blind spot: Whether the owner actually wants a straighter-arm target for their own fit is unverified.
- **Fix B**: Keep 150–160° but as an explicit, correctly-framed owner decision
  - Strength: OQ-2 is Block: yes, Owner: user — the elbow is the sharpest conflict and is legitimately the owner's call. The foundation doc would state plainly "gravel-fit literature targets ~85–95° included; we retain 150–160° because <owner's reason>", with no "different angle" claim.
  - Tradeoff: Needs an owner ruling the plan was trying to avoid; if there is no real reason to keep 150–160°, this just surfaces that Fix A is correct.
  - Confidence: HIGH — this is the honest representation of the conflict.
  - Blind spot: None significant.
- **Decision**: FIXED (2026-09-02) — web research (Exa) reversed the finding's premise. The elbow *included* angle (shoulder–elbow–wrist, 180° = straight) on the hoods is put at **150–170°** by every practitioner reference checked (BikeFittr printable angle chart; Indoor Cycling Association goniometer protocol, "15–25° bend"; torger.se; BikeSize; cyclingarchives; Fast Talk Labs). A ~90° *included* elbow is the aggressive TT/aero position (BikeFittr: "90–110° for tri / extensions"). `angle-to-adjustment-guide.md` §5's "85–95° (included angle at the elbow)" is within rounding of the *upper-arm-to-torso* "shoulder forward angle" that `bike-fitting-ref-angles.md:57` lists as a **separate** 80–90° row — a shoulder-angle mislabel, not a real convention. So the plan's decision to keep the elbow near 150–160° was **correct**; Fix A (reconcile toward 85–95°) would have been a regression, and `testing-angle-correctness/research.md:310–343`'s elbow conclusion is itself mistaken. Applied resolution: band **widened 150–160 → 150–165°** (owner call, to cover a relaxed upright gravel arm); "category error" / "upper-arm-to-torso row" claim replaced with the practitioner evidence in `plan.md` (Current State, Key Discoveries, Phase 1 §1), `plan-brief.md` (Key Decisions, Open Risks), and the Phase 1 `reference-angles.md` contract; retired-range list gains `150–160`; Phase 3 now also corrects `change.md`'s "The unresolved decision" note and the test-plan §7 elbow mention; new note that the foundation doc supersedes the prior research's elbow assessment. Post-fix dimension verdict: End-State Alignment FAIL → PASS.

### F2 — Prompt builder can't reproduce the current table from `ANGLE_REFS` + `measuredAt`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §1 (`buildRecommendationsSystemPrompt` contract) vs. "Critical Implementation Details — Prompt formatting parity"
- **Detail**: Phase 2 renders each row as `<name (included?)> | <min>–<max>° | <measuredAt>` and requires "en-dash and ° exactly as today", but the current prompt table (`llm.ts:12–18`) carries per-row qualifiers absent from `ANGLE_REFS` and not added by Phase 1: four rows say "(included)" while "Torso angle" does not, and torso's range cell reads "45–55° **from horizontal**", not "45–55°". Phase 1 §2 adds only `measuredAt`. The builder therefore has no data to decide which rows get "(included)" or to render torso's "from horizontal" — it would need another `ANGLE_REFS` field or per-key hard-coding (reintroducing the special-casing the change removes). The "(included?)" in the contract shows the author noticed but did not resolve this. Directly contradicts the "reproduce that exact formatting" requirement.
- **Fix**: Add a `convention: string` field to each `ANGLE_REFS` entry alongside `measuredAt` (e.g. "included" / "from horizontal") and render name + convention + range from it. Safe — `VideoAnalyzer` reads `ANGLE_REFS` field-by-field (no spread); the `angles.test.ts` pin asserts min/max only. Alternative: state explicitly that the generated table drops the "(included)" / "from horizontal" qualifiers and accept the wording change.
  - Strength: One field keeps `ANGLE_REFS` the sole source and preserves the prompt's precision.
  - Tradeoff: Third string field on a constant now doing double duty (verdict bands + prompt copy).
  - Confidence: HIGH — mirrors the `measuredAt` addition already in the plan.
  - Blind spot: None significant.
- **Decision**: FIXED (2026-09-02) — `convention: string` added to every `ANGLE_REFS` entry (`"included"` × 4, `"from horizontal"` for TORSO). Plan updated: Phase 1 §2 contract + heading, the canonical bands table (now `Angle | Band | Measured at | Convention`), Key Discoveries additive-safe note, the Phase 1 §5 pin test (asserts `convention` too, since it now feeds the prompt), Phase 2 §1 builder contract (`<name> (<convention>) | <min>–<max>° | <measuredAt>`, no per-key branching), Phase 2 §3 spec (asserts `(included)` and `Torso angle (from horizontal)`), Testing Strategy. One deliberate wording change recorded in "Prompt formatting parity" and the Phase 2 manual step: the torso row's "from horizontal" moves from the range cell to the name cell so all rows render uniformly.

### F3 — Desired-End-State verification command is unsatisfiable

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: plan.md:82–84 (Desired End State — Verification)
- **Detail**: The stated check — `grep -rn "Open Question #2\|OQ-2\|unresolved owner decision" context/ src/` returns only RESOLVED-annotated hits — always fails at that scope. `context/archive/2026-05-28-ai-analysis-pipeline/` (3 files) and `context/changes/testing-angle-correctness/` (plan.md, research.md, plan-brief.md, reviews/plan-review.md — ~20 hits) both reference OQ-2 as a correct historical record, and the plan rightly refuses to edit them (archive is read-only; the sibling change is done). Anyone running the stated command concludes the change failed.
- **Fix**: Narrow the Desired-End-State grep to the scope Phase 3 criterion 3.1 already uses (`context/foundation/` plus the specific `src/` files Phases 1–2 touch) and note that archive + `testing-angle-correctness` are deliberately excluded.
- **Decision**: FIXED (2026-09-02) — Desired-End-State "Verification" line rewritten to grep `context/foundation/` + the four `src/lib` files Phases 1–2 touch, with an explicit out-of-scope note for `context/archive/` and `context/changes/testing-angle-correctness/`.

### F4 — Phase 3 OQ-2 enumeration is incomplete

- **Severity**: 🔷 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §3 (roadmap edits), §4 (test-plan edits)
- **Detail**: `roadmap.md:118` ("that mitigation only activates once OQ-2 is resolved") is an OQ-2 mention not in Phase 3's edit list; criterion 3.1's grep flags it, so the implementer hits the gate and has to hunt. Separately, Phase 3 §4 edits test-plan §6.6/§7/§2 but not §6.1, whose oracle rule (`test-plan.md:180`) still names `context/archive/.../bike-fitting-ref-angles.md` as the quotable source — after Phase 1 §5 repoints the `angles.test.ts` header to the foundation doc, the cookbook and the test disagree.
- **Fix**: Add `roadmap.md:118` and test-plan §6.1 to the Phase 3 edit list.
- **Decision**: FIXED (2026-09-02) — Phase 3 §3 now says "OQ-2 appears in four places" and adds the `roadmap.md:118` mitigation-note reword; Phase 3 §4 adds the test-plan §6.1 oracle-rule repoint (archive path → `context/foundation/reference-angles.md`).

### F5 — KNEE_TDC band narrows 65–75 → 68–74; only the hip shift is flagged

- **Severity**: 🔷 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: plan-brief.md "Open Risks & Assumptions"; Phase 1 §2
- **Detail**: The brief flags that widening HIP to 55–70 can flip a returning user's verdict on a fresh run. KNEE_TDC goes from a 10°-wide band to a 6°-wide band (40% narrower) — the same class of effect (more borderline-fitted returning users flagged "Outside range"), unacknowledged.
- **Fix**: Add one line to the brief / reconciliation section noting the KNEE_TDC band also narrows.
- **Decision**: FIXED (2026-09-02) — plan-brief "Open Risks & Assumptions" gains a KNEE_TDC-narrows bullet (65–75 → 68–74, 40% narrower); plan.md "Migration Notes" gains a "Verdict shifts on re-run" paragraph covering all three shape changes (HIP widen, KNEE_BDC down 2°, KNEE_TDC narrow) and noting ELBOW can only un-flag.

### F6 — `npm run format` used as a pass/fail gate

- **Severity**: 🔷 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 Success Criteria — "Lint + format clean: `npm run lint` && `npm run format`"
- **Detail**: `package.json` `format` = `prettier --write .` — it mutates files and exits 0 regardless, so it verifies nothing.
- **Fix**: Use `npx prettier --check .` or drop it (lint + the pre-commit hook already cover formatting).
- **Decision**: FIXED (2026-09-02) — dropped. Phase 2 SC bullet is now "Lint clean: `npm run lint`" (with a note that `npm run format` mutates and always exits 0, so it is not a gate); Progress 2.3 updated to match.
