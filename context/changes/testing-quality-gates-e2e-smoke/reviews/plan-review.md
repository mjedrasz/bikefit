<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Quality-Gates Wiring + One E2E Smoke

- **Plan**: context/changes/testing-quality-gates-e2e-smoke/plan.md
- **Mode**: Deep
- **Date**: 2026-09-06
- **Verdict**: REVISE → SOUND after triage
- **Findings**: 2 critical, 3 warnings, 2 observations

## Verdicts

| Dimension              | Verdict (initial) | Verdict (after fixes) |
| ---------------------- | ----------------- | --------------------- |
| Requirement Definition | PASS              | PASS                  |
| End-State Alignment    | PASS              | PASS                  |
| Lean Execution         | PASS              | PASS                  |
| Architectural Fitness  | WARNING           | PASS                  |
| Blind Spots            | FAIL              | PASS                  |
| Plan Completeness      | WARNING           | PASS                  |

## Grounding

5/5 paths ✓, 9/9 symbols ✓ (`OPENROUTER_URL` @ llm.ts:10, `sessions_select_own`,
`sessions/[id].astro` 404 path, `/api/auth/signin` formData, `createAdminClient`
astro:env import, VideoUpload "View fitting recommendations" link, `<h1>Your
fitting results</h1>`, `bodyAngles.length < 2` throw, `ON DELETE CASCADE` FKs),
brief↔plan ✓, definitions 4/4 user-origin. Two grounding gaps caught: the named
video fixture (`video_fixed.mp4`) was removed by the out-of-scope scratch-file
cleanup, and a real-project `.dev.vars` on disk is unaddressed by the env story.

## Findings

### F1 — E2E Supabase credential flow + isolation not worked out

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Phases 2 / 3 / 4 / 5
- **Detail**: Three connected gaps. (1) The app reads `SUPABASE_URL` / `SUPABASE_KEY`
  / `SUPABASE_SERVICE_ROLE_KEY` from `astro:env/server` (`src/lib/supabase.ts:3`,
  `src/lib/services/supabase-admin.ts:2`); the plan wires `E2E_`-prefixed names
  that no step remaps → the preview server gets no Supabase config, every page
  503s. (2) `.dev.vars` exists on disk pointing `SUPABASE_URL` at the real project
  (`hucpghbsxwteiqknesus`), and `astro preview` reads it — a local `npm run
test:e2e` likely runs the pipeline, and the seed helper's `deleteUser`
  cascade, against real data; the plan never mentions the file or source
  precedence. (3) `e2e/helpers/seed-user.ts`'s contract calls `createAdminClient()`,
  which imports `astro:env/server` — unresolvable in Playwright's test runner
  (Vitest needed an explicit `resolve.alias` for exactly this).
- **Fix A ⭐ Recommended**: Map the `E2E_*` secrets to the app's real env names in
  the CI job and `playwright.config.ts` `webServer.env`; add a config-level guard
  that throws if `SUPABASE_URL` is the prod ref; the seed helper builds its own
  `@supabase/supabase-js` client from `process.env` and guards the ref; local docs
  point `.dev.vars` at the e2e project (Phase 3 spike 3.4 confirms whether
  `process.env` alone suffices).
  - Strength: single source of truth — the names the app already reads; the
    runtime guard is a stronger safety net than a naming convention.
  - Tradeoff: drops the "distinct names end-to-end" property (replaced by the guard).
  - Confidence: HIGH — matches how every other env var in this repo flows.
  - Blind spot: `.dev.vars`-vs-`process.env` precedence still needs spike 3.4.
- **Fix B**: Keep `E2E_` names; add an env-shim module + a global-setup step that
  backs up and rewrites `.dev.vars` before `astro preview`.
  - Strength: preserves the distinct-names intent.
  - Tradeoff: `.dev.vars` file juggling is fragile — a crash leaves prod
    `.dev.vars` clobbered; races with webServer startup.
  - Confidence: MED.
  - Blind spot: interaction with `reuseExistingServer` locally.
- **Decision**: FIXED via Fix A — edits to Current State Analysis (env bullet),
  Definitions/Phase 2 rationale, Phase 3 `playwright.config.ts` (SUPABASE\_\* remap
  - prod-ref guard + `baseURL` + `.dev.vars` note), Phase 4 `seed-user.ts` (own
    client + guard), Phase 5 CI env contract, criterion 3.5.

### F2 — Vitest `astro:env/server` stub not updated for `OPENROUTER_BASE_URL`

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 — changes #2 (astro.config.mjs) and #3 (llm.ts)
- **Detail**: Phase 3 makes `llm.ts` `import { OPENROUTER_BASE_URL } from
"astro:env/server"`. Both Vitest projects alias that module to
  `src/test/stubs/astro-env-server.ts`, which exports only the current four
  fields. A named import the alias target doesn't export is a hard ESM error →
  `llm.test.ts` / `analyze.test.ts` / `recommend.test.ts` (the required CI Vitest
  gate) break at import. test-plan.md §6.2 documents this exact "keep the stub in
  sync" hazard; the plan omitted the stub edit.
- **Fix**: Add `export const OPENROUTER_BASE_URL = undefined;` to the stub in the
  same commit (undefined → `OPENROUTER_BASE_URL || <real URL>` = real URL, so the
  existing undici mock still intercepts).
- **Decision**: FIXED — Phase 3 change #2 retitled and expanded; new criterion
  3.4 "`npm test` still green after the `llm.ts` + stub changes".

### F3 — Negative-test "not a false positive" proof step is invalid

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 4 — Success Criterion 4.2; Testing Strategy step 3; Desired End State verification
- **Detail**: "Temporarily dropping `sessions_select_own` makes the negative test
  fail red." `fitting_sessions` is `FORCE ROW LEVEL SECURITY` with two policies —
  dropping the only SELECT policy denies every authenticated read, so
  `maybeSingle()` still returns `{ data: null }`, `sessions/[id].astro` still
  404s, and the negative test stays **green**. The step proves nothing and would
  not catch a test that 404s for a benign reason.
- **Fix**: Make the policy permissive for the check (`ALTER POLICY
sessions_select_own ON fitting_sessions USING (true)`, then restore) so user B
  can read user A's row and the test goes red.
- **Decision**: FIXED — criterion 4.2, Progress 4.2, Testing Strategy step 3, and
  the Desired End State verification paragraph all updated.

### F4 — No mechanism keeps the e2e Supabase project's schema current

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 2; Migration Notes
- **Detail**: Phase 2 pushes the four existing migrations once. Nothing keeps the
  e2e project in sync as future migrations land — no CI step, no cookbook note.
  Once a later change adds a migration, the e2e project silently drifts and the
  required `e2e` gate tests a stale schema.
- **Fix A ⭐ Recommended**: `npx supabase link` + `npx supabase db push` against
  the e2e project as a step in the CI `e2e` job (needs `SUPABASE_ACCESS_TOKEN` +
  `E2E_SUPABASE_DB_PASSWORD` secrets).
  - Strength: e2e schema always at HEAD; a broken migration also fails `e2e`.
  - Tradeoff: two more secrets; ~10-20s per run.
  - Confidence: MED — standard pattern, not yet used in this repo.
  - Blind spot: `db push` idempotency on an already-migrated remote not verified.
- **Fix B**: Document-only note in test-plan §6.5 + Migration Notes.
  - Strength: zero CI complexity, no new secrets.
  - Tradeoff: relies on a human remembering — the exact failure this is about.
  - Confidence: HIGH cheap / LOW followed.
  - Blind spot: none significant.
- **Decision**: FIXED via Fix A — Phase 2 secrets list (+2), Phase 5 CI job step,
  Migration Notes, criterion 5.3, Progress 2.4 / 5.3. Also flipped the §5
  typecheck row to "required (wired)" in Phase 5 change #2 (promise-gap: Phase 1
  shipped that CI step but no phase reconciled the row).

### F5 — Phase 4 fixture contract names a file that no longer exists

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4 — change #1 (`e2e/fixtures/bike-fit-sample.mp4`)
- **Detail**: Contract says "renamed from `video_fixed.mp4` (~590KB … no
  orientation caveat)". That file is gone (the out-of-scope scratch-file cleanup
  removed it). What remains: `video_left.mp4` (523,755 B) and `video_right.mp4`
  (502,766 B), both 788×1146 H.264/AAC 2.807s — and both orientation-named.
- **Fix**: Repoint at `video_right.mp4` (standard side-on view; passes
  `VideoUpload.tsx`'s gates — mp4, <100MB, 2.81s ≥ `MIN_DURATION` 2); confirm ≥2
  angles during Phase 4 tuning.
- **Decision**: FIXED — Phase 4 change #1 and Current State Analysis bullet updated.

### F6 — Teardown hook: `afterAll` vs `test.afterEach` inconsistency

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Requirement Definition
- **Location**: Definitions table row 2 vs Phase 4 change #3
- **Detail**: Definitions row 2 says "`afterAll` calls `teardown()`"; Phase 4 §3
  says "`test.afterEach`". `afterEach` is safer — runs after a failed test, so a
  CI retry re-seeds cleanly.
- **Fix**: Make both read `test.afterEach`.
- **Decision**: FIXED — Definitions row 2 updated.

### F7 — Required `e2e` check cannot get secrets on fork PRs

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 5 — required-status-checks
- **Detail**: `on: pull_request` runs from a fork get no repo secrets, so a
  required `e2e` job is permanently red on external contributions. Non-issue for
  a solo course project.
- **Fix**: No action unless the repo takes fork PRs.
- **Decision**: DISMISSED — solo project; not worth recording in the plan.

## Triage Summary

| Outcome   | Findings                               |
| --------- | -------------------------------------- |
| Fixed     | F1 (Fix A), F2, F3, F4 (Fix A), F5, F6 |
| Dismissed | F7                                     |

Verdict after fixes: **SOUND**. The one remaining open item — whether
`webServer.env` overrides `.dev.vars` for the workerd preview server — is an
empirical spike the plan already schedules (criterion 3.5) with a documented
fallback, i.e. normal plan risk, not an outstanding review finding.
