---
change_id: resolve-angle-reference-bands
title: Resolve the authoritative gravel angle reference bands (PRD OQ#2 / Roadmap OQ-2)
status: open
created: 2026-09-02
updated: 2026-09-02
archived_at: null
---

## Notes

**Tracking only — no implementation.** This is the durable home for the
**reference-band dimension of Risk #1**: *which* numeric range each of the
five body angles is judged against.

### Why this exists

`context/changes/testing-angle-correctness/` (test-plan §3 Phase 1) defends
only the **geometry / convention** dimension of Risk #1 — that the code
measures the angle the fitting literature *means* (correct vertex,
included-vs-flexion convention, torso from horizontal), verified against an
oracle taken from the archived reference-angle notes. It deliberately does
**not** assert against the shipped `ANGLE_REFS` values, and `angleVerdict`
is unit-tested with synthetic bands. Once §3 Phase 1 is marked `complete`,
"Risk #1 defended" must not be read as covering the bands themselves.

### The unresolved decision

The reference bands are **triplicated and contested**:

- `src/lib/pose/angles.ts` `ANGLE_REFS.ELBOW` = `150–160°` (competitive-road
  convention).
- `context/archive/2026-05-28-ai-analysis-pipeline/angle-to-adjustment-guide.md:126–128`
  gives `85–95°` for gravel/hoods and its own **Convention note** explicitly
  flags the conflict — the `150–160°` figure reflects "a flatter, more
  aggressive position with nearly straight arms," the `85–95°` figure "a
  gravel/recreational position where the upper body is more upright."
- The same ranges are re-stated as prose in the recommendations system
  prompt (`src/lib/services/llm.ts`).

The owner decision needed: the **authoritative gravel road-position
reference bands for all five angles** (knee at BDC, knee at TDC, hip, torso,
elbow), sourced from bike-fitting literature or a certified-fitter consult,
per Roadmap OQ-2. Owner: user. Block: yes.

### Links

- `context/changes/testing-angle-correctness/plan.md` — the Phase 1 plan
  that scoped this out (see "What We're NOT Doing").
- `context/foundation/test-plan.md` §7 — negative-space entry for the
  reference-band dimension.
- `context/foundation/prd.md` Open Question #2.
- `context/foundation/roadmap.md` Open Roadmap Question 2.
