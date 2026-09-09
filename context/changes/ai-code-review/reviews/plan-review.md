<!-- PLAN-REVIEW-REPORT -->

# Plan Review: AI Code-Review CI/CD Workflow

- **Plan**: `context/changes/ai-code-review/plan.md`
- **Mode**: Deep
- **Date**: 2026-09-09
- **Verdict**: REVISE → **SOUND after triage** (all 10 findings addressed)
- **Findings**: 2 critical, 4 warnings, 4 observations
- **Triage**: 2026-09-09 — F1 Fix A (3-phase restructure), F2/F3/F4/F6/F7/F8/F10 fixed as
  proposed, F5 fixed differently (diff stays a string, no temp file), F9 fixed wider than
  proposed (gate made obligatory + blocking, fail-open on infra). `plan.md` and `plan-brief.md`
  rewritten accordingly.

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | FAIL    |
| Lean Execution        | WARNING |
| Architectural Fitness | PASS    |
| Blind Spots           | FAIL    |
| Plan Completeness     | WARNING |

Overall: **REVISE** — F1 and F2 block implementation as written, but both are fixable inside
the current three-phase approach (not a redesign).

## Grounding

8/8 paths ✓ (`packages/code-reviewer/src/{schemas,reviewer,cli,format,index}.ts`, `tools.ts`,
`test/reviewer.test.ts`, `test/fixtures/{insecure-login,db}.ts` all exist as the plan expects;
`.github/actions/` and `.github/workflows/ai-code-review.yml` correctly absent/new).
Symbols ✓ except the `provider` config key (F4): `maxCost`/`maxTokensUsed`/`stepCountIs`
exported from `@openrouter/agent`; `getUsage(): Promise<SessionUsageTotals>` and `signal?:
AbortSignal` present; `provider?: ProviderPreferences` on `ResponsesRequest` but the field is
`requireParameters`, not `require_parameters`; `maxOutputTokens` available on `ResponsesRequest`;
`plugins: [{ id: "response-healing" }]` shape correct; root `tsconfig.json` `exclude`
`["dist","packages"]`, eslint `ignores: ["packages/**"]`, `.prettierignore` `packages`, package
`package-lock.json` all present. brief↔plan consistent (hard-floor rule A, single tool-less call,
5-key criteria object, advisory gate, parked comment/labels).

## Findings

### F1 — Phase 1 leaves the package non-building; its own gates can't pass

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: End-State Alignment
- **Location**: Implementation Approach + Phase 1
- **Detail**: "Implementation Approach" promises each phase leaves the package "in a building
  state" and "independently mergeable." Phase 1 rewrites `schemas.ts` (removes
  `severitySchema`/`categorySchema`/`findingSchema`/`verdictSchema` + types, drops
  `verdict`/`findings` from `reviewSchema`) and `index.ts` (drops those exports +
  `createFileReader`/`createFileTools`) but does not touch `src/format.ts`, `src/cli.ts`, or
  `test/reviewer.test.ts`, all of which reference the removed surface: `format.ts:1` imports
  `Severity`, `:28` `Record<Review["verdict"],…>`, uses `review.findings` /
  `finding.severity|category|title|description`; `cli.ts:93` `review.verdict ===
"request_changes"`; `test/reviewer.test.ts:6` imports `createFileReader`, `cannedReview` uses
  `verdict`/`findings`/`severity`/`category`, plus the whole `createFileReader` describe block.
  `tsconfig.build.json` sets `noEmitOnError` and compiles `src/**`, so `npm run build` (1.1) and
  `npm run typecheck` (1.2) fail on `format.ts`/`cli.ts`; `npm test` (1.3) fails on
  `reviewer.test.ts`. Phase 1 cannot pass its own automated verification and is not mergeable
  alone.
- **Fix A ⭐ Recommended**: Fold the renderer + CLI + fake-client-test rewrites into Phase 1 so
  one phase lands a compiling package; Phase 2 shrinks to engine + delete `tools.ts` +
  integration-test-to-diff-fixture.
  - Strength: Every phase compiles and merges; matches the plan's own stated invariant. The
    renderer/CLI edits are the natural other half of a contract change (`format.ts` is 73 lines).
  - Tradeoff: Phase 1 grows ~40%; the "pure contract, zero I/O" framing is diluted.
  - Confidence: HIGH — broken references are concrete; `noEmitOnError` is set.
  - Blind spot: Exact size of the `format.ts` rewrite not measured.
- **Fix B**: Keep Phase 1 additive — introduce the scored schema as a new export
  (`scoredReviewSchema` + `decide`), leave `reviewSchema`/`verdict`/`findings` and the old
  exports in place, and do every removal + the `reviewSchema` swap in Phase 2 alongside the
  `format.ts`/`cli.ts`/test rewrites.
  - Strength: Phase 1 stays pure and independently mergeable with no churn to `format.ts`/`cli.ts`.
  - Tradeoff: Phase 2 carries the naming swap; a placeholder schema name lives in the tree
    between phases, weakening "freeze the contract other phases depend on."
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — plan restructured to 3 phases. Phase 1 now lands schema +
  `decide` + `reviewer.ts` engine + `format.ts` + `cli.ts` + full unit suite (compiles,
  mergeable); Phase 2 shrinks to deleting `tools.ts`/fixtures + diff-fixture integration test
  - README. Progress section rewritten to match.

### F2 — Two of the three "cost/time bounds" are no-ops for a single call

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details / Phase 2 §1 / Performance Considerations
- **Detail**: The plan leans on `stopWhen: [maxCost(0.5), maxTokensUsed(200_000)]` as two of
  three guards. In `@openrouter/agent` (`stop-conditions.d.ts`) these are `StopCondition`s the
  agent loop evaluates _between steps_ to decide whether to iterate again. This design has no
  tools → exactly one model request → the loop ends naturally regardless of `stopWhen`. Neither
  condition can prevent or truncate the single generation; the spend has already happened when
  they'd be checked. Only `signal` (`AbortSignal.timeout`) and the job `timeout-minutes`
  actually bound the call, and both bound _time_, not _cost_. Meanwhile the compute-diff step
  admits up to a 900 KB diff (~220–260K input tokens); at `anthropic/claude-sonnet-4.5` input
  rates (~$3/M) that is ~$0.65–0.80 of input alone — already over the `--max-cost 0.5` default,
  with nothing enforcing it, and output is uncapped (`maxOutputTokens` is never set). The
  advisory job stays green either way, so the cost is invisible.
- **Fix**: Set `maxOutputTokens` on the `callModel` request (`ResponsesRequest`,
  `responsesrequest.d.ts:171`) as the real generation cap; size the compute-diff byte budget to a
  cost target (~250 KB ≈ 60–70K tokens ≈ ~$0.20 input) or raise the documented per-review cost
  and the `--max-cost` default to match reality; keep `maxCost`/`maxTokensUsed` only as
  future-proofing for a tools variant and stop describing them as active bounds for this
  single-call design.
  - Strength: `maxOutputTokens` + a sane diff budget give a genuine, computable per-review
    ceiling; aligns the plan with how the SDK actually works.
  - Tradeoff: A tighter budget truncates large PRs sooner (already only "handled by truncation
    with a marker").
  - Confidence: HIGH on the mechanism (verified in `stop-conditions.d.ts` + `async-params.d.ts`);
    MED on the token/$ figures (pricing not fetched live).
  - Blind spot: `claude-sonnet-4.5` exact OpenRouter pricing and default `max_output_tokens` not
    verified this pass.
- **Decision**: FIXED — Critical Implementation Details + Key Discoveries now state `stopWhen`
  conditions are between-step and inert for a single tool-less call. `maxOutputTokens` (default
  8k) added as the real generation cap; compute-diff byte budget cut to ~300 KB sized to a
  ~$0.35 per-review target; `--max-output-tokens` CLI/action input added; `maxCost`/`maxTokens`
  kept only as future-proofing. Performance Considerations rewritten.

### F3 — Score range: schema says one thing, tests + decide() need another

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §1 + "Critical Implementation Details"
- **Detail**: Phase 1 §1 shows `score: z.number().int()` and Critical Details says score "must be
  `z.number().int()` with a `.describe()` … Do not rely on `.min(1).max(10)`." But
  `z.number().int()` alone accepts 0, 11, −5 — `reviewSchema.parse` won't reject them. Phase 1's
  own test contract requires "an out-of-range `score` (0, 11) → `ReviewParseError`", and
  `decide()` (`minScore`, `failing[]`) trusts the range. The implementer cannot satisfy both; if
  they resolve it by dropping the test, a model returning `score:0` or `score:15` silently
  corrupts the decision.
- **Fix**: Specify `score: z.number().int().min(1).max(10).describe("1–10, 1 = worst")`. Reword
  the note to mean "the provider ignores `minimum`/`maximum` under emulated strict mode, so
  client-side `parse()` is the only enforcement" — not "omit them."
- **Decision**: FIXED — schema block now shows
  `z.number().int().min(1).max(10).describe("1–10, 1 = worst")`; the schema-intro text and
  Critical Implementation Details reworded to "the provider ignores min/max under emulated
  strict mode, so `parse()` is the only enforcement — but the bounds must be present for
  `parse()` to reject 0/11/15."

### F4 — provider key is `require_parameters`; the installed SDK type wants `requireParameters`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §1, "Note on provider / signal placement", plan-brief "Key Decisions"
- **Detail**: The plan specifies `provider: { require_parameters: true }` in three places.
  `@openrouter/sdk`'s `ProviderPreferences` type (`providerpreferences.d.ts:118`) exposes this as
  `requireParameters` (camelCase); `require_parameters` (`:173`) is only the `$Outbound` wire
  shape. The snake_case key is a type error — and the plan's own fallback note ("if the types
  reject it, fall back to plugins") makes that the expected path, while naming the wrong key.
- **Fix**: Use `provider: { requireParameters: true }`. Keep the `plugins: [{ id:
"response-healing" }]` fallback note — that shape is correct (`responsehealingplugin.d.ts`).
  Drop the "verify whether the key is accepted" framing; the camelCase key is confirmed present.
- **Decision**: FIXED — `provider: { requireParameters: true }` in the reviewer engine section,
  the field-placement note, and plan-brief Key Decisions; a Key Discovery documents the
  camelCase-vs-`$Outbound` distinction (`providerpreferences.d.ts:118` vs `:173`); the "verify
  whether it's accepted" step removed. `plugins: [{ id: "response-healing" }]` fallback kept.

### F5 — Diff transport: `$GITHUB_OUTPUT` leg adds a 1 MB cap and 4 hops the action doesn't need

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Lean Execution
- **Location**: Phase 3 §1 step 4 + §2 diff step
- **Detail**: Path: git → shell var → `$GITHUB_OUTPUT` heredoc (1 MB cap, char-based
  `${FULL:0:BUDGET}` truncation) → step output → action input → `INPUT_DIFF` env var (~900 KB) →
  heredoc → `$RUNNER_TEMP/pr.diff` → CLI `--diff-file`. The action already lands the diff in a
  file; the `$GITHUB_OUTPUT` leg adds the only hard size limit in the pipeline, a
  randomised-delimiter heredoc, a big env-var round-trip, and a truncation whose marker unit
  ("bytes shown") doesn't match bash substring semantics in a UTF-8 locale. Plan-brief
  attributes the transport choice to "User instruction" — flag for the user's call.
- **Fix A ⭐ Recommended**: The compute-diff step writes `"$RUNNER_TEMP/pr.diff"` directly
  (`$RUNNER_TEMP` is shared with the composite action in the same job); the action takes a
  `diff-path` input (default `"$RUNNER_TEMP/pr.diff"`) and passes it straight to `--diff-file`.
  - Strength: Deletes two hops and the only hard size limit; truncation (if still wanted) becomes
    byte-exact `head -c` on a file.
  - Tradeoff: The action's input contract is a filesystem path rather than self-contained text —
    slightly less reusable outside this workflow (repo-local action, one caller).
  - Confidence: HIGH — `$RUNNER_TEMP` cross-step persistence is documented.
  - Blind spot: None significant.
- **Fix B**: Keep `$GITHUB_OUTPUT` transport; make truncation byte-based (`LC_ALL=C` or `head -c
$BUDGET`), lower `BUDGET` well under 1 MB with headroom for the heredoc framing, and confirm
  the ~900 KB env-var size is within `ARG_MAX`.
  - Strength: Preserves the user's "pass via `$GITHUB_OUTPUT`" instruction.
  - Tradeoff: Keeps the cap and the hops; more moving parts to get right.
  - Confidence: MED — runner env-var size ceilings not measured.
  - Blind spot: GitHub's undocumented action-input size handling at ~900 KB.
- **Decision**: FIXED DIFFERENTLY (user direction) — the diff stays a **string** end-to-end:
  compute-diff → `$GITHUB_OUTPUT` → action `diff` input → CLI `--diff` flag, **no temp file
  anywhere**. `--diff-file` kept only as a local/test convenience (exactly one of `--diff` /
  `--diff-file` required). Truncation made byte-based under `LC_ALL=C`; budget cut to ~300 KB
  (F2), which also keeps the `--diff` argv well under `ARG_MAX`. `$GITHUB_OUTPUT` transport
  retained per the user's original instruction.

### F6 — The reviewer package that gates every PR has zero automated test coverage

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: "What We're NOT Doing" + Phase 3 §1
- **Detail**: The composite action runs `npm ci` + `npm run build` only. The package's vitest
  suite (`schemas.test.ts`, `decide.test.ts`, `reviewer.test.ts`) is excluded from root vitest
  (`vitest.config.ts:41`) and run by no workflow — so after this ships, the code deciding
  pass/fail on every PR has no regression protection. "What We're NOT Doing" cites a user
  instruction ("no package CI job") but never surfaces this consequence. Notable given the whole
  change sits under the test-strategy rollout.
- **Fix**: Add `npm test` as a step in the composite action right after `npm run build` — deps
  are already installed, costs a few seconds, gives per-PR regression coverage with no separate
  job. If the user still wants it out, record "no regression protection for the reviewer package"
  as a `test-plan.md` §7 negative-space line on the eventual `--refresh`.
- **Decision**: FIXED — composite action gets a `npm test` step right after `npm run build`
  (step 4 of 7). "What We're NOT Doing" and plan-brief Key Decisions updated: still no separate
  package CI job, but the vitest suite now runs per-PR inside the action.

### F7 — Composite-action path gymnastics

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 3 §1 steps 2–4
- **Detail**: The action locates the package via `${{ github.action_path
}}/../../../packages/code-reviewer` and sets `working-directory` to that with `..` traversal.
  It's a repo-local action (`uses: ./.github/actions/...`) and the package is in the same
  checkout; composite steps already default `working-directory` to `$GITHUB_WORKSPACE`.
- **Fix**: Use `working-directory: packages/code-reviewer` and `node
packages/code-reviewer/dist/cli.js` (workspace-relative).
- **Decision**: FIXED — composite action steps now use `working-directory: packages/code-reviewer`
  for the npm steps and `node packages/code-reviewer/dist/cli.js`; the `../../../` traversal is
  gone.

### F8 — Workflow interpolates `${{ github.base_ref }}` into the `run:` script

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 §2 diff step
- **Detail**: `BASE="origin/${{ github.base_ref }}"` and `git fetch … "${{ github.base_ref }}"`
  put a `${{ }}` value in the shell body. The same plan passes PR title/body via `env:` for
  exactly this reason, and `ci.yml` scopes every secret to its step. `base_ref` is a git ref name
  (low real risk) but it's inconsistent with the repo's posture.
- **Fix**: Pass `BASE_REF: ${{ github.base_ref }}` via the step's `env:` and reference
  `$BASE_REF`.
- **Decision**: FIXED — compute-diff step now sets `env: { BASE_REF: ${{ github.base_ref }} }`
  and the script uses `"$BASE_REF"` / `"origin/$BASE_REF"`; no `${{ }}` in the shell body.

### F9 — Advisory + `continue-on-error` means a fully broken gate shows green forever

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 §1 step 4 + §2
- **Detail**: Job is advisory, CLI step is `continue-on-error: true`, CLI exits non-zero only on
  infra error. A missing `OPENROUTER_API_KEY` (exit 2), `requireParameters` routing to zero
  endpoints (`decision:"error"`), or a stale model slug all produce a green check with the reason
  buried in a passing job's log. Detection depends on someone reading that log.
- **Fix**: Emit a `::warning::` (or `::error::` without failing the job) annotation when
  `review.json` `decision == "error"` or the CLI exits 2, so a broken gate is visible on the PR
  checks surface without blocking merges.
- **Decision**: FIXED DIFFERENTLY (user direction — gate made obligatory, wider than the
  finding's fix). The plan is reversed from advisory to **blocking on review quality**: CLI
  exit model is now `0` pass / `1` review-fail / `2` bad-usage / `3` infra-error; the composite
  action gains a **gate step** that `exit 1`s on CLI-exit-1 (fails the job) and, via a new
  required-status-check step on `master`, blocks the PR. **Fail-open on infra** (user's pick):
  exit `2`/`3` emit a `::error::` annotation and the job passes. `continue-on-error` replaced by
  the `set +e` + `${PIPESTATUS[0]}` capture. Overview, Desired End State, "What We're NOT
  Doing", Manual Verification, Migration Notes, Testing Strategy, and plan-brief (Key Decisions,
  Scope, Open Risks incl. a new flaky-gate risk, Success Criteria) all updated.

### F10 — Markdown review goes to stdout (plain text), not `$GITHUB_STEP_SUMMARY`

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 3 §1 steps 4–5, Desired End State
- **Detail**: `formatReviewMarkdown` output is written to step stdout, which GitHub renders as
  preformatted text in the log — the 5-row score table won't render as a table. Also minor:
  Phase 3 §3 tells the implementer to set `change.md` `status: planned`, which is stale by the
  time Phase 3 runs.
- **Fix**: Also append the Markdown rendering to `$GITHUB_STEP_SUMMARY` (one `>>` redirect in the
  CLI step) so the review renders as a real table on the run Summary page. Keep the log copy too.
- **Decision**: FIXED — the review step pipes the CLI through `tee -a "$GITHUB_STEP_SUMMARY"`
  so the Markdown renders as a table on the run summary and still lands in the log. The stale
  "set `change.md` `status: planned`" instruction in Phase 3 §3 is dropped (now just
  `updated:`, `status` left for `/10x-implement`). Desired End State + plan-brief mention the
  run summary.
