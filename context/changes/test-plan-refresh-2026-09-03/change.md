---
change_id: test-plan-refresh-2026-09-03
title: Test-plan refresh — mutation testing (StrykerJS) enters the stack
status: complete
created: 2026-09-03
updated: 2026-09-03
archived_at: null
---

## Notes

`/10x-test-plan --refresh`. Trigger: **the test stack changed** — StrykerJS
mutation testing was added to the project this session:

- `@stryker-mutator/core@^10.0.0` + `@stryker-mutator/vitest-runner@^10.0.0` (devDependencies)
- `stryker.config.json` — `testRunner: vitest`, `mutate` scoped to the four
  pure-logic modules Phase 1 covers (`src/lib/pose/angles.ts`,
  `src/lib/angle-verdict.ts`, `src/lib/recommendations-prompt.ts`,
  `src/lib/format-angle.ts`), `thresholds.break: null`
- `npm run test:mutation` → `stryker run`
- First run (2026-09-03): **89.72% mutation score**, 96 killed / 11 survived
  (10 in `pose/angles.ts`, 1 in `recommendations-prompt.ts`), 0 errors, ~40 s

## Scope (user decisions, 2026-09-03 interview)

1. **Cover mutation testing only.** No change to §1 Strategy or §2 Risk Map —
   the 7-risk map was reviewed and holds. The `review.md` hardening list maps
   onto existing rollout Phases 2–4; no new risk surfaced.
2. **Config + docs only — no new rollout phase, no research/plan/implement
   chain.** Stryker already runs and is verified. This refresh edits
   `test-plan.md` directly (§4, §5, §6, §7, §8).
3. **Advisory / local-only gate posture.** Mutation score is reported, never
   breaks CI (`break: null` kept). Run locally / on-demand when touching the
   pure-logic modules — same scoping as the §5 post-edit hook.

## Edits applied to context/foundation/test-plan.md

- **Header** — `Last updated` line stamped for this refresh.
- **§4 Stack** — added a `mutation testing` row (StrykerJS 10 + vitest-runner,
  `checked: 2026-09-03`), with the `mutate`-scoping and advisory-posture note.
- **§5 Quality Gates** — added a `mutation score (Stryker)` row: local +
  on-demand, `advisory (not gated)`, catches assertion-free / tautological
  tests that line coverage rewards.
- **§6 Cookbook** — new **§6.7 Checking a suite with mutation testing**: run
  command, what the config mutates and why it is scoped, how to read a
  survivor, the kill-or-consciously-accept discipline, and the current
  survivor list as the worked example.
- **§7 Negative space** — added a note bounding what mutation testing does
  _not_ cover (only the 4 `astro:env`-free pure-logic modules; not the LLM
  boundary, route handlers, or model accuracy; not a CI gate).
- **§8 Freshness Ledger** — added a `2026-09-03` refresh entry; recorded
  Stryker as stack-verified on that date.
- **§3 housekeeping** (not scope, but reconciled while editing) — Phase 2
  (`testing-llm-and-ownership`) status `change opened` → `researched`:
  `research.md` is present on disk.

No downstream handoff. Refresh complete on write.
