---
change_id: testing-angle-correctness
title: Test harness bootstrap + joint-angle correctness (test-plan rollout Phase 1)
status: implemented
created: 2026-09-01
updated: 2026-09-02
archived_at: null
---

## Notes

Rollout Phase 1 of `context/foundation/test-plan.md`. Defends **Risk #1**:
joint-angle / keypoint math is subtly wrong — the app computes angles that
do not match the reference-frame definitions they are judged against — so
every in-range verdict and every fitting recommendation built on them is
confidently wrong.

Scope for this phase (from test-plan.md §2 Risk Response Guidance + §3):

- Stand up the test runner as the first sub-phase — no runner exists yet.
  Vitest via `getViteConfig` from `astro/config` so `astro:env`, the `@/*`
  alias, and the Vite plugin chain resolve. DOM env (happy-dom or jsdom)
  for the pure helpers that live in the browser pipeline component.
- Prove: given known keypoint fixtures, computed angles match the
  bike-fitting **reference** definitions (correct vertex, included-vs-
  flexion convention, torso measured from horizontal) within a stated
  tolerance; a left-facing and a right-facing clip both resolve to the
  correct body side.
- Must challenge: "the angle the code computes is the angle the fitting
  literature means"; and "the server would catch a bad result" — it will
  not, it persists whatever the browser posts.
- Anti-pattern to avoid: the oracle problem — asserting a function returns
  the value it happens to return today, or snapshotting current output.
  The oracle comes from the reference-angle definitions, not the code.
- Test types: unit (pure functions) only. No integration / e2e in this
  phase.
- Final sub-phase updates test-plan.md §6.1 (unit-test cookbook pattern).

Reference-angle definitions live in
`context/archive/2026-05-28-ai-analysis-pipeline/bike-fitting-ref-angles.md`
and `.../angle-to-adjustment-guide.md`.

Next: `/10x-research testing-angle-correctness` — this phase needs the code
grounded (angle formulas, keypoint-index contract, how the pose model's
coordinates map onto the reference definitions) before a plan.
