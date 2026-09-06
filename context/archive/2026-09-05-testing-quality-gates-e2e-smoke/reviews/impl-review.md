<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Quality-Gates Wiring + One E2E Smoke

- **Plan**: context/changes/testing-quality-gates-e2e-smoke/plan.md
- **Scope**: Phases 1–5 of 5 (full plan review)
- **Date**: 2026-09-06
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations
- **Triage**: F1 fixed · F2 accepted · F3 skipped · F4 fixed

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | WARNING |

## Evidence

- `npx tsc --noEmit` — exit 0 (Phase 1.1)
- `npm test` — 18 files, **170 passed** (Phase 3.4 regression guard: `llm.ts` + stub changes did not break the contract/route suites)
- `npm run lint` — 0 errors, 3 pre-existing warnings in untouched files
- `.github/workflows/ci.yml` — parses cleanly (Phase 5.1)
- `e2e/upload-analysis-results.spec.ts` — exactly **2 `test()` blocks** (Definitions-table verification requirement met)
- Plan-review F1–F6 fixes all present in the delivered code: `SUPABASE_*` remap + prod-ref guard in `playwright.config.ts`, second prod-ref guard in `seed-user.ts`, `OPENROUTER_BASE_URL` added to the Vitest stub, permissive-policy phrasing in criterion 4.2, fixture repointed to `video_right.mp4`, `test.afterEach` teardown.
- Negative RLS test is sound: `sessions/[id].astro` returns a bare `Response(null, {status: 404})`, no `404.astro` exists to mask it, and criterion 4.2's `USING (true)` path renders a 200 "Couldn't load your results" page → test goes red as intended.
- CI-run / cloud / dashboard criteria (2.x, 3.5, 4.1–4.4, 5.2–5.5) are attested via progress SHAs and cannot be independently re-verified from the working tree; the code paths and spike documentation are consistent with the checked state.

## Findings

### F1 — §3 rollout table still shows Phase 4 as "change opened"

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/foundation/test-plan.md:99
- **Detail**: Every phase's `## Progress` checkbox is `[x]`, `change.md` status is `implemented`, and the §3 rows for Phases 1–3 read "complete" — but the Phase 4 row still reads "change opened", its pre-work value. Phase 5's stated purpose is reconciling the test-plan to shipped state; it correctly flipped the two §5 gate rows, but the §3 rollout table (the most-consulted status surface, and the one line 92 says the orchestrator keeps current) now contradicts reality. Phase 5 change #2's contract narrowly listed only §5 edits, and the separate §3 reconciliation commit (`5d3cf48`) predated Phases 4–5 landing, so nothing ever advanced this row.
- **Fix**: Set the §3 table Phase 4 Status cell to "complete" (matches the Phase 1–3 sibling rows and the `[x]` Progress state).
- **Decision**: FIXED — test-plan.md:99 Status cell "change opened" → "complete".

### F2 — llm.ts uses `??` where the plan contract specified `||`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/services/llm.ts:15
- **Detail**: Phase 3 change #3's contract was bolded "the fallback pattern matters, this is the only place production behavior must stay byte-identical when the var is unset" and wrote `OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1/chat/completions"`. The implementation uses `??`, with a code comment citing the repo's `prefer-nullish-coalescing` gate (confirmed: `npm run lint` is clean with `??` and would error on `||`). Verified equivalent for every real path — prod leaves the var unset → `undefined` → real URL; the Vitest stub exports `undefined`; `playwright.config.ts` always sets a concrete URL. `??` and `||` diverge only if the var is explicitly `""`, which nothing in the tree does. No production-behavior change.
- **Fix**: None required — deviation is lint-mandated, documented in-code, and verified behavior-equivalent.
- **Decision**: ACCEPTED — verified equivalent for all real paths; lint gate forces `??`. No change.

### F3 — playwright.config.ts prod-ref guard throws on every config load

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: playwright.config.ts:12
- **Detail**: The `throw` when `E2E_SUPABASE_URL` is unset sits at module top level, so it fires on any Playwright entrypoint that loads the config — `playwright test --list`, `show-report`, `codegen` — not only real runs. Confirmed: `npx playwright test --list` in a bare shell exits with the guard error, so Phase 3's criterion 3.1 ("`npx playwright test --list` runs cleanly") only holds with the e2e env exported. CI is unaffected (job-level `env:` sets the var). The fail-safe intent is sound; the cost is coupling static introspection to runtime secrets.
- **Fix**: If the coupling is unwanted, move the guard into a `globalSetup` module (runs before tests, not on bare config load).
- **Decision**: SKIPPED — top-level fail-safe kept deliberately; the DX cost is accepted.

### F4 — e2e CI job exposes the service-role key to all steps

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: .github/workflows/ci.yml:36
- **Detail**: `E2E_SUPABASE_SERVICE_ROLE_KEY` (full RLS bypass on the e2e project) is set at job-level `env:`, so it is in the environment of `npm ci` and `npx playwright install --with-deps` — steps that execute third-party install scripts. The plan's Phase 5 intent was "least-privilege on secrets"; the job boundary is honored (the main `ci` job never sees it), but within the job the three `E2E_SUPABASE_*` vars are only consumed by `npx playwright test` (via `playwright.config.ts` and `seed-user.ts`). Matches the plan's explicit "Job-level `env:`" wording, so this is a plan-level hardening note. Low stakes — throwaway project, no real data.
- **Fix**: Move the three `E2E_SUPABASE_*` vars (and the `OPENROUTER_API_KEY` placeholder) from job-level `env:` to a step-level `env:` on the `npx playwright test` step.
- **Decision**: FIXED — ci.yml e2e job: removed job-level `env:`, moved `E2E_SUPABASE_*` + `OPENROUTER_API_KEY` onto a step-level `env:` on the `npx playwright test` step. YAML re-validated. `npm ci` / `astro sync` / `playwright install` no longer see the e2e keys.
