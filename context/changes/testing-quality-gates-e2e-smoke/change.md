---
change_id: testing-quality-gates-e2e-smoke
title: Testing quality gates e2e smoke
status: implemented
created: 2026-09-05
updated: 2026-09-06
archived_at: null
---

## Notes

This is **§3 Phase 4** of the test-plan rollout — _Quality-gates wiring + one
e2e smoke_ (cross-cutting: locks in Risks #1–#7 protections shipped in
Phases 1–3 as required CI gates; also touches the deferred real cross-user
check for Risk #5). Test types planned: e2e (1 flow), gates.

Risk response intent (from `context/foundation/test-plan.md` §3 Phase 4 goal
and §6.4's deferred-check note):

- **CI gates**: make typecheck (`npx tsc --noEmit`) and the full Vitest
  suite (angle-math, LLM-boundary, ownership, rate-limit, payload-cap,
  output-contract regressions — see test-plan §5) required CI steps, not
  just local (lefthook) gates — close the gap where `--no-verify` or a
  fresh clone only gets lint + test + build today.
- **e2e smoke**: prove the upload → analysing → results flow works
  end-to-end against a real running app (Playwright), seeded via the
  Supabase Auth admin API — the one flow this suite holds, per test-plan
  §6.5.
- **Grounding question for research**: test-plan §6.4 (Risk #5 ownership
  pattern) explicitly defers "the real two-user cross-RLS check — user B's
  real, signed-in request against user A's real session, hitting deployed
  RLS" to this phase. Confirm whether that fits inside the single
  happy-path flow's scope or needs a second, narrowly-scoped e2e case; the
  test-plan's Phase 4 goal as written says "one e2e smoke," so don't expand
  scope without flagging it back.
