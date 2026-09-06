# Quality-Gates Wiring + One E2E Smoke — Plan Brief

> Full plan: `context/changes/testing-quality-gates-e2e-smoke/plan.md`
> Research: `context/changes/testing-quality-gates-e2e-smoke/research.md`

## What & Why

Test-plan.md §3 Phase 4, the last rollout phase: make `tsc --noEmit` a
required CI step (the full Vitest suite is already required), and build a
from-zero Playwright e2e layer — one happy-path smoke over upload →
analysing → results, plus the deferred Risk #5 real cross-user RLS check.

## Starting Point

CI runs lint + the full Vitest suite (already gating every Phase 1–3 risk
response) + build, but has no typecheck step. Playwright doesn't exist in
this repo. The deferred Risk #5 check (test-plan.md §6.4) has only
stub-level coverage today — a mocked Supabase client proves the _handler_
would scope correctly, never that the deployed RLS policy itself does.

## Desired End State

Every PR runs two required gates beyond today's: `tsc --noEmit`, and a
separate `e2e` job that boots a real `astro preview` (workerd) server,
seeds two real throwaway Supabase users via the admin API, drives a real
browser through a real video upload to a rendered results page, and
separately proves a second user gets `404` reading the first user's
session.

## Key Decisions Made

| Decision                        | Choice                                                                           | Why (1 sentence)                                                                                 | Source                |
| ------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------- |
| Risk #5 check placement         | Second `test()` in the same suite                                                | Cheap (no second upload/LLM run), keeps Playwright's per-test isolated context                   | Plan (session)        |
| OpenRouter in e2e               | Mocked at the network edge                                                       | Deterministic, free, no live billing/rate-limit risk on a merge gate                             | Plan (session)        |
| Supabase environment            | Dedicated e2e project                                                            | Zero risk to the real hosted project even if cleanup has a bug                                   | Plan (session)        |
| Seeded-user cleanup             | Delete in test teardown                                                          | Safe regardless of environment; `ON DELETE CASCADE` clears sessions/results                      | Plan (session)        |
| CI rollout posture              | Required from day one                                                            | Matches test-plan.md §5's stated end-state directly, no trial period                             | Plan (session)        |
| Retry/timeout policy            | `retries: 1` in CI + 300s timeout                                                | Absorbs one-off blips without masking a real break                                               | Plan (session)        |
| CI job structure                | Separate `e2e` job                                                               | Least-privilege secret exposure; clearly labeled failure in PR checks                            | Plan (session)        |
| Scratch-file/leaked-key cleanup | Out of scope — handled by you directly                                           | Fastest fix for an active credential exposure; doesn't wait on this plan                         | Plan (session)        |
| OpenRouter mock mechanism       | Local HTTP server + new `OPENROUTER_BASE_URL` override, keyed on request `model` | Workerd sandbox has its own fetch — a Node-level `undici` mock can't reach it                    | Plan (research spike) |
| Env-var propagation to workerd  | Playwright `webServer.env` is sufficient, no `.dev.vars` needed                  | Cloudflare vite-plugin's dev-var loader falls back to `process.env` (verified in `node_modules`) | Plan (research spike) |

## Scope

**In scope:** CI typecheck step; dedicated e2e Supabase project + secrets;
Playwright scaffolding; an OpenRouter network-edge stand-in; a committed
video fixture; the happy-path smoke; the Risk #5 negative test; the
required `e2e` CI job; test-plan.md §5 reconciliation.

**Out of scope:** repo-root scratch-file/leaked-key cleanup (your direct
action); live OpenRouter calls in CI; non-blocking trial period for the
new gate; Firefox/WebKit coverage; write-path cross-user tests (already
stub-covered); any change to mutation-testing scope.

## Architecture / Approach

Five phases: (1) the independent, zero-risk typecheck step; (2) external
provisioning of a throwaway Supabase project + three new GitHub secrets,
gated on your go-ahead; (3) Playwright config + a tiny local HTTP server
standing in for OpenRouter, verified with zero real tests; (4) the seeding
helper (admin-API user + real-signin-captured `storageState`), the
committed fixture, and the two `test()`s; (5) the required, separate `e2e`
CI job.

## Phases at a Glance

| Phase                               | What it delivers                              | Key risk                                                           |
| ----------------------------------- | --------------------------------------------- | ------------------------------------------------------------------ |
| 1. CI typecheck gate                | `tsc --noEmit` required in CI                 | None — direct lift from the local hook                             |
| 2. Dedicated e2e Supabase project   | New project, migrations pushed, 3 new secrets | Needs your explicit go-ahead (cloud resource + secrets)            |
| 3. Playwright + OpenRouter stand-in | Config, mock server, 0 real tests yet         | Confirming env vars truly reach the workerd sandbox                |
| 4. Seeding, fixture, the two tests  | Both `test()`s passing locally                | Mocked BDC/TDC timestamps may need tuning against the real fixture |
| 5. Required `e2e` CI job            | Both `ci`/`e2e` required on every PR          | First-run flakiness blocks a real PR (accepted per your choice)    |

**Prerequisites:** your go-ahead before Phase 2 provisions a cloud resource and writes repo secrets; `gh`/`supabase` CLI auth (already confirmed working).
**Estimated effort:** ~3-4 sessions across 5 phases — Phase 3/4 (from-zero Playwright + the mock mechanism) is the bulk of the work.

## Open Risks & Assumptions

- The mocked BDC/TDC timestamps are a best guess against the real committed video; expect to tune them once Phase 4 runs pose detection for real.
- Required-from-day-one means the very first flaky run blocks a PR — accepted, not mitigated by a trial period.
- Phase 2's external steps (project creation, secret writes) are not run without your explicit approval at implementation time.

## Success Criteria (Summary)

- Every PR shows `ci` (with typecheck) and `e2e` as required, passing checks.
- The e2e suite proves the real upload→results flow completes end to end, and that a second real user is denied a first user's session — against a real deployed RLS policy, not a mock.
- Breaking either the flow or the RLS policy turns the relevant check red without touching the other.
