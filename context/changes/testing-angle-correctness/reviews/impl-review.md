<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Test Harness Bootstrap + Joint-Angle Correctness

- **Plan**: context/changes/testing-angle-correctness/plan.md
- **Scope**: Full plan (Phases 1–5, all Progress items `[x]`)
- **Date**: 2026-09-02
- **Verdict**: NEEDS ATTENTION → **TRIAGED 2026-09-02** (F1, F2, F4 fixed; F3 acknowledged, no action)
- **Findings**: 0 critical, 2 warnings, 2 observations

## Triage Outcome (2026-09-02)

| Finding | Decision | Notes |
|---------|----------|-------|
| F1 — Vitest config deviation + stale cookbook | FIXED (doc) | `test-plan.md` §6.1 rewritten (+ new Config paragraph); `format-angle.test.ts` comment; `plan.md` Key Discoveries bullet. No code change. |
| F2 — `23c0413` bundled 7 unplanned files | FIXED (doc) | `plan.md` gained an "Addendum — Out-of-Plan Changes During Rollout" section. Code unchanged. |
| F3 — `test-plan.md` first committed in Phase 5 | ACKNOWLEDGED | No action; content coherent. Workflow note: commit foundation docs at creation. |
| F4 — `sessions/index.ts` lost `!data` guard | FIXED (code) | Guard restored via `const row: unknown = data` to stay lint-clean. lint + tsc + tests green. |

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Summary

The core of the plan landed well. The pure-math extraction (Phase 2) is genuinely
behaviour-preserving — `pickExtremumFrame` keeps the strict `>`/`<` + `∓Infinity`
seed (first-wins-on-tie), the per-timestamp call site, and both `... && bdcLandmarks)
continue` guards verbatim; `convertKeypoints` maps the same COCO→slot pairs. The
`computeTorsoAngle` fix (`atan2(|dy|,|dx|)`) is geometrically correct and the spec
suite is genuinely oracle-driven (geometry- and reference-doc-derived expectations,
no snapshots, no "returns what it returns today"). The verdict-helper extraction
(Phase 4) matches the plan exactly. All automated criteria pass now: `npm test`
(35 passing), `npx tsc --noEmit`, `npm run lint`, `npm run build`, and `npm test`
from a clean state (no `.astro`).

Two things need attention: Phase 1 shipped a **different Vitest config** than the
plan specified (plain `defineConfig`, not `getViteConfig`; no `pretest` script),
the deviation is undocumented, and the Phase 5 cookbook still describes the
abandoned mechanism — which matters because `§6.1` is the durable guide `/10x-tdd`
reads. And a "fix lint errors" commit swept 7 unplanned files into the branch,
one of them (`llm.ts`) explicitly on the "What We're NOT Doing" list.

## Findings

### F1 — Vitest config deviates from plan; Phase 5 cookbook documents the abandoned mechanism

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: vitest.config.ts:1; package.json (scripts); context/foundation/test-plan.md §6.1; plan.md:811 (Progress 1.2)
- **Detail**:
  Plan Phase 1 #2 (`plan.md:282-300`) specifies `getViteConfig` from `astro/config`;
  Phase 1 #1 (`plan.md:270-279`) and plan-review F4 (marked "FIXED — pretest script")
  specify `"pretest": "astro sync"` in `package.json`. The implementation shipped
  neither: `vitest.config.ts` uses plain `defineConfig` from `vitest/config` with a
  hand-declared `@/*` alias, and there is no `pretest` script. The switch is
  **defensible** — the file comment (`vitest.config.ts:4-9`) explains `getViteConfig`
  drags in the Cloudflare adapter, which is incompatible with Vitest's `ssr`
  environment — and it is functionally verified (`rm -rf .astro && npm test` is green
  because nothing in the test graph touches `astro:env`).
  The problem is that the deviation is unrecorded and the docs now misdescribe it:
  - `plan.md` Progress step 1.2 still reads "`pretest` runs `astro sync`" and is
    ticked `[x]`.
  - `test-plan.md` §6.1 "Run command" states: "`npm test` is self-contained from a
    fresh checkout — `pretest` runs `astro sync` so the `astro:env` virtual module
    resolves." False on both counts. §6.1 is the canonical "how do I add a test here?"
    guide that `/10x-tdd` consumes in the next lesson.
  - `src/lib/format-angle.test.ts:4-6` comment claims the spec proves "Astro's Vite
    plugin chain" resolves — it exercises neither.
- **Fix**: Correct `test-plan.md` §6.1 "Run command" + "Environment" paragraphs to
  describe the shipped config (plain `defineConfig`, manual `@/*` alias, no `pretest`,
  `astro:env` intentionally out of the unit-test graph); fix the `format-angle.test.ts`
  header comment; add a one-line "deviation from plan Phase 1 #2 / plan-review F4" note
  to `plan.md` Key Discoveries so the record is consistent.
  - Strength: Keeps the durable cookbook accurate before Lesson 2 builds on it; the
    code itself is correct and needs no change.
  - Tradeoff: Doc-only churn across three files.
  - Confidence: HIGH — verified `vitest.config.ts` from commit `87d26b3` onward and
    confirmed `npm test` passes with `.astro` absent.
  - Blind spot: None significant.
- **Decision**: FIXED — `test-plan.md` §6.1 rewritten (Run command: no `pretest`; new
  **Config** paragraph explaining plain `defineConfig` vs `getViteConfig` and flagging §4
  for `--refresh`); `src/lib/format-angle.test.ts` header comment corrected (no "Astro's
  Vite plugin chain"); `plan.md` Key Discoveries gained a "Deviation from plan Phase 1 #2 /
  plan-review F4" bullet noting the stale Progress 1.2 wording and frozen §4 row. No code
  change. `npm test` (35) + `npm run lint` green after edits.

### F2 — "fix lint errors" commit bundles 7 unplanned files, including `llm.ts` (explicitly "NOT doing")

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: commit 23c0413 — src/lib/services/llm.ts:140,196; src/components/VideoUpload.tsx (−91 lines); eslint.config.js:64-72; src/pages/api/sessions/index.ts:40; src/pages/api/analyze.ts; src/pages/api/sessions/[id].ts
- **Detail**:
  `plan.md:176-177` "What We're NOT Doing": *"No changes to `src/lib/services/llm.ts`."*
  Commit `23c0413` changes it anyway (response type `choices` → `choices?`, defensive).
  It also deletes ~91 lines of polling machinery from `VideoUpload.tsx` (the
  `polling` state, `startPolling`, `StatusBadge`, error-retry refs), adds an
  `astro`-parser `parserOptions` block to `eslint.config.js` (plan said "verify only
  — likely no change"), and prettier-reflows three API routes. The polling code was
  already dead on master (`startPolling` is defined once and never called in
  `ebd9351:src/components/VideoUpload.tsx`), so these are pre-existing lint failures
  swept up to satisfy Phase 1's "`npm run lint` passes" criterion — understandable,
  but landed under a terse message with no plan traceability, mixed into the feature
  branch. `src/pages/api/sessions/index.ts:40` also drops a runtime guard (see F4).
- **Fix**: Leave the code (reverting re-breaks `npm run lint`), but add an addendum
  to `plan.md` recording the out-of-plan lint cleanup and the `llm.ts` touch, so the
  next review doesn't re-flag it as untracked drift. Going forward, keep unrelated
  lint-debt fixes on their own commit/PR.
  - Strength: Preserves work that is individually benign; makes the source of truth
    match what shipped.
  - Tradeoff: The plan's "NOT doing" list becomes a slightly moving target.
  - Confidence: HIGH — every changed hunk in `23c0413` inspected; `startbPolling`
    confirmed dead on master.
  - Blind spot: Have not confirmed CI `lint` was actually red on master (no run
    history available), only that the code shape implies it.
- **Decision**: FIXED — added an "Addendum — Out-of-Plan Changes During Rollout" section to
  `plan.md` (after Migration Notes) itemising all 7 files in `23c0413`, noting the `llm.ts`
  touch stayed within the "no de-dup" intent, cross-linking F4, and recording the
  keep-lint-debt-on-its-own-PR rule going forward. Code left as-is (reverting re-breaks
  `npm run lint`).

### F3 — `test-plan.md` first enters git in Phase 5 as a wholesale add; "frozen §1–§5" unverifiable

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/test-plan.md (first commit acf86e2)
- **Detail**: `git log -- context/foundation/test-plan.md` shows a single commit —
  `acf86e2` (Phase 5). The file is absent from `ebd9351` (pre-branch master). Phase 5
  #1–#3 phrase the work as *"Replace the §6.1 placeholder"* / *"Fill §6.6"* /
  *"Extend §7"* — edits to an existing frozen document — but the commit adds the
  entire file. Phases 1–4 (research, plan, plan-review) all cite `test-plan.md` as
  ground truth while it was untracked, and there is no committed baseline to verify
  §1–§5 (which "only `/10x-test-plan --refresh` may edit") were untouched during the
  rollout.
- **Fix**: No action needed for this change — the shipped content is coherent. Note
  for the workflow: `/10x-test-plan` should commit `test-plan.md` at creation, not
  leave it for a rollout phase to add.
- **Decision**: ACKNOWLEDGED — no action. Shipped `test-plan.md` content is coherent and
  there is no evidence §1–§5 drifted during the rollout. Workflow note stands:
  `/10x-test-plan` should commit `test-plan.md` at creation, not defer it to a rollout
  phase's commit.

### F4 — `sessions/index.ts` lost its `!data` runtime guard

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/sessions/index.ts:40 (commit 23c0413)
- **Detail**: `if (error || !data)` → `if (error)`. If Supabase ever returns
  `{ error: null, data: null }` (the types say it won't; the old code defended it
  anyway), the handler now falls through to `session.id` on a `null` cast and throws
  an unhandled 500 with a stack, instead of the clean
  `Response.json({ error: "Failed to create session" }, { status: 500 })`.
- **Fix**: Restore `if (error || !data)`.
- **Decision**: FIXED — guard restored in `src/pages/api/sessions/index.ts:37-45`. A literal
  `if (error || !data)` re-triggers `@typescript-eslint/no-unnecessary-condition` (`data` is
  inferred `null` for a string `.select()` on the admin client), so the value is routed
  through `const row: unknown = data` and the guard is `if (error || !row)` — restores the
  clean-500 behaviour and stays lint-clean. `npm run lint` + `npx tsc --noEmit` + `npm test`
  (35) green.
