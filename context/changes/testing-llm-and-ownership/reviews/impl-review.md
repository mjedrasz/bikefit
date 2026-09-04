<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: LLM boundary + API-route integration (test-plan Phase 2)

- **Plan**: context/changes/testing-llm-and-ownership/plan.md
- **Scope**: Phase 6 of 6 (full plan — all phases complete)
- **Date**: 2026-09-04
- **Verdict**: NEEDS ATTENTION (all 3 findings fixed during triage — see Decisions below)
- **Findings**: 1 critical, 1 warning, 1 observation

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | FAIL    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Findings

### F1 — Lefthook migration is intentional but incomplete: dead Husky artifacts + stale CLAUDE.md + coverage gap

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: lefthook.yml:1-11, package.json:37,59-60,74-81, CLAUDE.md:18 (commit `6001460`,
  confirmed intentional by the later `context/changes/test-plan-refresh-2026-09-04/` interview,
  commit `47cd281`)
- **Detail**:
  _Correction from the initial pass_: commit `6001460` "install lefthook" is not silent scope
  creep — the follow-up `/10x-test-plan --refresh` (`47cd281`) explicitly confirmed with the
  user that Lefthook is the intended live pre-commit gate and documented it in
  `test-plan.md` §4/§5/§6.8. Its own `change.md` scopes cleanup as "a Lesson-3-scope decision
  outside this skill" — i.e. deliberately deferred, not missed.

  What that refresh did _not_ touch, and is still true on disk right now:
  - `.husky/pre-commit` (`npx lint-staged`), the `"lint-staged"` config block in
    `package.json:74-81`, and the `husky` devDependency (`package.json:59`) are all still
    present — dead config, since `.git/hooks/pre-commit` is lefthook's self-installed shim
    (confirmed: `git config --get core.hooksPath` unset, `.git/hooks/pre-commit` contains
    `call_lefthook run "pre-commit"`) and lefthook's `postinstall` script rewrites that shim on
    every `npm install`/`npm ci`.
  - `CLAUDE.md:18` still reads _"Pre-commit hooks: husky + lint-staged runs `eslint --fix` on
    `_.{ts,tsx,astro}`and`prettier --write`on`_.{json,css,md}`"_ — now factually wrong,
    and self-contradicting CLAUDE.md's own Lesson-3 section a few lines down.
  - Coverage regression, not just documentation drift: `lefthook.yml`'s `lint` command globs
    `*.{ts,tsx,js,jsx}` (no `.astro`) and has no equivalent of lint-staged's
    `*.{json,css,md}` → `prettier --write` rule. Since Husky no longer runs, `.astro` files get
    no pre-commit lint and `.json`/`.css`/`.md` files get no pre-commit formatting at all —
    strictly less coverage than before, not a like-for-like swap.
  - Minor aside: `lefthook` sits under `"dependencies"` (`package.json:37`), inconsistent with
    every other dev tool in the repo (`husky`, `eslint`, `prettier`, `vitest`, `undici` are all
    under `"devDependencies"`).

- **Fix**: Finish the migration the refresh already committed to — remove `.husky/`, the
  `lint-staged` block, and the `husky` devDependency; add a `"prepare": "lefthook install"`
  script; widen `lefthook.yml`'s `lint` glob to include `.astro` and add a command mirroring
  `*.{json,css,md}` → `prettier --write`; move `lefthook` to `devDependencies`; update
  `CLAUDE.md:18` to describe Lefthook instead of Husky.
  - Strength: Closes the gap between what `test-plan.md` now says is true and what's actually
    on disk; restores the lost `.astro`/`.json`/`.css`/`.md` coverage.
  - Tradeoff: Touches files outside this change's own plan (CLAUDE.md, package.json scripts) —
    arguably belongs to the Lesson-3 hooks work rather than this review's triage.
  - Confidence: HIGH — direction is already confirmed by the user; this is cleanup, not a
    decision.
  - Blind spot: None significant.
- **Decision**: FIXED — removed `.husky/`, the `lint-staged` block, and the `husky`
  devDependency; added `"prepare": "lefthook install"`; widened `lefthook.yml` to a `format`
  command (`prettier --write` on staged `*.{json,css,md}`) and an `.astro`-inclusive `lint`
  glob; moved `lefthook` to `devDependencies`; updated `CLAUDE.md:18` (local/gitignored file,
  not committed). Verified: `npx lefthook run pre-commit` runs `format` + `typecheck` clean
  against the staged changes; `npm test` still 145/145; `npx tsc --noEmit` and `npm run lint`
  clean.

### F2 — Manual test script points at the wrong dev-server port

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: scripts/test-analyze.sh:12 (commit `ac717ef`)
- **Detail**:
  `ac717ef` correctly updated the script to require a `session_id` arg and send it in the
  payload (matching Phase 4's `analyzeRequestSchema` change), but also changed
  `API="http://localhost:4321/api/analyze"` to port **4322** with no accompanying config change
  or comment. `README.md:99,104` both still document the dev server as `http://localhost:4321`,
  `astro.config.mjs` has no `server.port` override, and the only `4322` anywhere in the repo is
  the unrelated Supabase Postgres port (`supabase/config.toml:29`). This script is exactly what
  Phase 4's manual verification step (§ "A curl to /api/analyze with a session_id the caller
  doesn't own → 404") relies on — as written, running it against a plain `npm run dev` will
  connection-refuse.
- **Fix**: Change `scripts/test-analyze.sh:12` back to port 4321 (or, if 4322 is intentional
  — e.g. a local wrangler-proxy setup — add a one-line comment explaining why).
- **Decision**: FIXED — port reverted to 4321; also corrected the stale usage-comment on
  lines 2-3, which still omitted the `<session-id>` arg.

### F3 — Stale Stryker mutation-scope comment on `session-display-status.test.ts`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/session-display-status.test.ts (header comment)
- **Detail**:
  The header comment claims `session-display-status.ts` is "in Stryker's `mutate` scope
  alongside §6.1's other pure-unit modules," but `stryker.config.json`'s `mutate` array only
  lists `src/lib/pose/angles.ts`, `angle-verdict.ts`, `recommendations-prompt.ts`,
  `format-angle.ts`, and `llm-response.ts` — `session-display-status.ts` is absent. The plan's
  Phase 5 contract never actually required Stryker coverage for this file (only Phase 2
  mandates it, for `llm-response.ts`), so this isn't a Success-Criteria failure — just a
  comment asserting something that isn't true.
- **Fix**: Either add `"src/lib/session-display-status.ts"` to `stryker.config.json`'s `mutate`
  array (it's a pure function, cheap to include), or edit the test file's header comment to
  drop the Stryker claim.
- **Decision**: FIXED — added `"src/lib/session-display-status.ts"` to `stryker.config.json`'s
  `mutate` array; the test file's header comment is now accurate.
