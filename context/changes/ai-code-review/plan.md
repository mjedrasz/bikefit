# AI Code-Review CI/CD Workflow Implementation Plan

## Overview

Turn the standalone `packages/code-reviewer/` package into a GitHub-shaped review tool and
wire it into CI. Every pull request to `master` triggers a thin workflow that computes the PR
diff, hands off to the repo's first composite action, and runs a single OpenRouter model call
that scores the change against **5 criteria** (`pr_clarity`, `minimal_readable`, `tested`,
`input_safety`, `secrets_authz`) on a 1–10 scale plus a holistic general assessment. The
completed review is printed to the Actions job log and rendered on the run summary; a review
that scores any criterion below the `fail-below` floor (default 5) **fails the job and blocks
the PR** via a required status check. Infra errors (OpenRouter outage, missing key, hard
parse failure) are annotated on the PR checks surface but do not block. PR comments and labels
are **parked** for a follow-up change.

## Current State Analysis

- **`packages/code-reviewer/` exists** (added in `fc1f69d`), built on `@openrouter/agent@^0.11.0`.
  Today it is an _agentic_ reviewer: `createReviewer()` gives the model two filesystem tools
  (`list_files` / `read_file`, `tools.ts`) and asks for a `{ summary, verdict, findings[] }`
  JSON review (`schemas.ts:65-76`). It has a CLI (`cli.ts`), a terminal renderer
  (`format.ts`), and a vitest suite with an injected fake client (`test/reviewer.test.ts`).
- **The package is fully isolated from root tooling** as of `7d8924e`: root `tsconfig.json`
  `exclude: ["dist", "packages"]`, `eslint.config.js` `{ ignores: ["packages/**"] }`,
  `.prettierignore` `packages`. Root `vitest` never scanned it (`vitest.config.ts:41`).
  Consequence: **the package has zero CI coverage today** — it is neither built, typechecked,
  linted, nor tested by any workflow. CI on `master` is green (run `34398087542`).
- **`.github/workflows/ci.yml` is the only workflow.** No `.github/actions/`, no composite
  action, no reusable workflow anywhere. `ci.yml` triggers on `push` + `pull_request` to
  `master`, node 24, and scopes every secret to an individual `run:` step (`ci.yml:49-56`) —
  a deliberate least-privilege pattern from a prior impl-review.
- **No `OPENROUTER_API_KEY` repo secret.** The e2e job passes a literal `e2e-mock-unused`
  (`ci.yml:60-62`) because the app's LLM calls are mocked. The `ai-cr:*` labels do not exist
  (repo has only the 9 GitHub defaults).
- **`requirements.md`** froze the criteria set at 5 (3 general + 2 security); the 4 TypeScript
  criteria are parked (already covered by `tsc --noEmit` + `eslint strictTypeChecked`).

### Key Discoveries

- **Strict structured output is best-effort on OpenRouter and provider-dependent**
  (research §E). `anthropic/claude-*` supports `json_schema` via emulation; adherence is not
  guaranteed. This is why `extractJson` / `parseReview` / `ReviewParseError`
  (`reviewer.ts:83-113`) exist — **all three carry over unchanged**. OpenAI-dialect strict
  mode also ignores `minimum` / `maximum` / `minItems`, so a score range and an array length
  can only be enforced client-side by `reviewSchema.parse`.
- **A fixed 5-key object beats an array** for the criteria (research §F). Strict mode cannot
  enforce `minItems`, so `z.array(criterion)` lets the model legally return 3 blocks or two
  with the same id. `z.object({ pr_clarity, minimal_readable, tested, input_safety,
secrets_authz })` with all keys required is structurally guaranteed by Zod 4's emitter
  (`additionalProperties:false` + full `required[]`) and a missing key becomes a clean
  `ReviewParseError`.
- **`.nullable()` not `.optional()` everywhere** (`schemas.ts:3-12`). The same schema is
  converted to JSON Schema _and_ used to parse output; every field must round-trip through
  strict structured outputs, which forbid optional keys. This constraint carries into the
  redesign.
- **The SDK's default retry is dangerous for a CI gate** (research §E): `@openrouter/sdk`
  retries `5XX` with backoff for `maxElapsedTime: 3_600_000` (~1 hour). A CI job MUST bound
  this — `callModel` accepts `signal?: AbortSignal` (verified `async-params.d.ts:77`,
  `model-result.d.ts`).
- **`maxCost` / `maxTokensUsed` are between-step `StopCondition`s, not generation caps**
  (`@openrouter/agent` `stop-conditions.d.ts`). The agent loop evaluates them _between_ steps
  to decide whether to iterate again. This design has no tools → exactly one model request →
  the loop ends after it regardless; neither condition can prevent or truncate that single
  generation, and the spend has already happened by the time they would be checked. The real
  per-review ceiling here is **`maxOutputTokens`** on the request (`responsesrequest.d.ts:171`)
  plus a **byte-bounded input diff**. `maxCost` / `maxTokensUsed` are kept only as
  future-proofing for a later tools variant — not described as active bounds.
- **The provider "require parameters" key is `requireParameters` (camelCase)** in the
  installed `@openrouter/sdk` `ProviderPreferences` type (`providerpreferences.d.ts:118`);
  `require_parameters` (`:173`) is only the `$Outbound` wire shape and is a type error as an
  input key. Use `provider: { requireParameters: true }`; the
  `plugins: [{ id: "response-healing" }]` fallback shape is confirmed
  (`responsehealingplugin.d.ts`) if a future SDK bump drops the field.
- **`getUsage()` reports aggregate cost** — `ModelResult.getUsage(): Promise<SessionUsageTotals>`
  `{ modelCalls, inputTokens, outputTokens, totalTokens, cachedTokens, cost? }`, **never
  rejects** (verified `model-result.d.ts:1326-1338`). `cost` is present only when the
  provider returned it. This is how the review reports its cost in the log footer.
- **Composite actions cannot use `secrets:` or declare `permissions:`** (verified against
  current GitHub docs). Secrets are passed in as `inputs`; `permissions` live on the calling
  workflow. Every `run:` step needs `shell:`. `$GITHUB_ACTION_PATH` / `${{ github.action_path }}`
  locates the action's own directory. Nested `uses:` must be pinned by tag or SHA.
- **`$GITHUB_OUTPUT` is capped at 1 MB per job** (verified against current GitHub docs).
  Multiline values use a heredoc delimiter (`name<<DELIM … DELIM`); the delimiter must not
  appear on its own line inside the value, so it is randomised. Per the user's decision the
  diff travels as a **string** the whole way — compute-diff → `$GITHUB_OUTPUT` → action `diff`
  input → CLI `--diff` flag — with **no intermediate file**. The compute-diff step truncates
  to a **byte** budget under `LC_ALL=C` (so bytes == chars and the `"N of M bytes shown"`
  marker is accurate — plain `${FULL:0:N}` in a UTF-8 locale counts code points, not bytes).
  F2's cost-sized budget keeps the string well under the 1 MB cap and the `--diff` argv value
  well under `ARG_MAX`.
- **`pull_request`, not `pull_request_target`** (research §D). Same-repo PRs get repo secrets
  and a write `GITHUB_TOKEN` under `pull_request`; `pull_request_target` is the "pwn request"
  vector. Fork PRs (no secrets under `pull_request`) are out of scope for this solo repo — a
  prior plan-review already dismissed the fork-secrets gap as "solo project."
- **Lessons that apply** (`context/foundation/lessons.md`): use `z.treeifyError(err)` (not
  `.flatten()`) for any Zod error formatting; if a step shells out to type-check, use
  `npx tsc --noEmit` (the package's own `npm run build` / `npm run typecheck` scripts are
  fine — they are defined).
- **The package pins its own newer toolchain** (`typescript ^7.0.2`, `vitest ^5.0.0`,
  prettier `printWidth: 80`). Per the user decision, keep it isolated — do **not** align to
  the monorepo root and do **not** add an npm-workspace or a root CI job.

## Desired End State

- Opening or updating a PR to `master` runs an **AI code review** workflow that finishes in a
  few minutes and posts nothing to the PR — the full scored review (general assessment,
  a 5-row score table, per-criterion notes with `file:line`, pass/fail against the
  `fail-below` floor, and model + cost) is visible in the **Actions job log** and rendered as
  a table on the **run summary** (`$GITHUB_STEP_SUMMARY`).
- The review is a **single** OpenRouter call: PR title + description + the diff in the prompt,
  no tools. Per-review cost is bounded by `maxOutputTokens` on the request plus the
  byte-bounded input diff; wall-clock by an `AbortSignal` deadline and the job
  `timeout-minutes`.
- The gate is **blocking on review quality**: a review that scores any criterion below
  `fail-below` (default 5) makes the CLI exit non-zero, the `review` job fail, and — via a
  required status check on `master` — the PR unmergeable. It is **fail-open on infra**: an
  OpenRouter outage, a missing key, or a hard parse failure produces `decision: "error"`, a
  `::error::` annotation on the PR checks surface, and a **passing** job (the PR author cannot
  fix a third-party outage).
- `packages/code-reviewer/` builds cleanly (`npm run build`) and its vitest suite passes
  locally **and inside the review action** (`npm test` runs before the review); `dist/` is
  built fresh by the composite action on every run.
- Verification: open a draft PR with a deliberately unsafe diff → the workflow runs, the log
  shows low `input_safety` / `secrets_authz` scores, `decision: fail`, and the **job fails**;
  open a clean PR → high scores, `decision: pass`, job green.

## What We're NOT Doing

- **No PR comment.** Parked. The review lives in the job log and the run summary only.
- **No labels.** `ai-cr:passed` / `ai-cr:failed` / `ai-cr:review` are not created, set, or
  removed. The `labeled`-event retry trigger and its label-removal cleanup are parked.
- **No branch-protection config beyond one required check.** The `review` job is added to
  `master` as a required status check (blocking gate); no other protection rules, code-owner
  rules, or merge-queue settings are touched.
- **No agent tools / file reading.** The reviewer sees only what is in the prompt (title,
  description, diff). `tools.ts`, `createFileReader`, `createFileTools`, and the file-reader
  fixtures are deleted.
- **No TypeScript-specific criteria** (`no_any`, `null_safety`, …) — parked in
  `requirements.md`, already covered by existing CI gates.
- **No package CI job, no npm workspaces, no toolchain alignment.** The package stays
  isolated; its only CI exercise is `npm run build` inside the review action.
- **No `src/lib/services/llm.ts` refactor.** The app's own OpenRouter usage (raw `fetch`,
  Gemini models) is a different pattern and is left alone.
- **No `context/foundation/test-plan.md` §5 / §6 edits.** Recording the AI review as a gate
  is a later `/10x-test-plan --refresh`, not this change.
- **Adding the `OPENROUTER_API_KEY` repo secret** is a manual prerequisite the user performs
  (documented in Phase 3); this plan does not touch repo secrets.

## Implementation Approach

Three phases, each independently mergeable and each leaving `packages/code-reviewer/` in a
building state. The scored schema in `schemas.ts` and every module that imports it
(`reviewer.ts`, `format.ts`, `cli.ts`, and the fake-client tests) break together under
`noEmitOnError`, so the contract swap and the engine / renderer / CLI rewrites land in **one**
phase — splitting them would leave Phase 1 unable to pass its own build:

1. **Scored contract + single-call reviewer + CLI + Markdown output** — the new `schemas.ts`
   - pure `decide.ts`, the tool-less bounded `reviewer.ts`, the Markdown renderer in
     `format.ts`, the new CLI flags / result-file / exit model, and the full fake-client + unit
     test suite. `tools.ts` stays in-tree, unreferenced.
2. **Remove agent tooling + diff-fixture integration test + docs** — delete `tools.ts` and the
   file-reader fixtures, add the unified-diff fixture, rework the opt-in real-model test to
   review a diff, add the package `README.md`.
3. **CI wiring** — the composite action and the blocking workflow, the required-status-check
   step, and the operator docs. Depends on the CLI contract from Phase 1.

This mirrors the repo's established pattern for CI-gate rollouts (research §K): small
independently-mergeable phases, the gate ships with what it gates, no ride-along scope creep.

## Critical Implementation Details

- **Score range: the schema must declare `.min(1).max(10)` even though the provider ignores
  it.** `criterionScoreSchema.score` is
  `z.number().int().min(1).max(10).describe("1–10, 1 = worst")`. A strict-`json_schema`
  provider ignores `minimum` / `maximum` under emulated strict mode, so `reviewSchema.parse`
  rejecting out-of-range values into a `ReviewParseError` is the _only_ runtime enforcement —
  but `.min(1).max(10)` must be present for `parse()` to do that, and Phase 1's own test
  asserts `score` of 0 or 11 → `ReviewParseError`. "Don't rely on the provider" ≠ "omit the
  bounds."
- **`parseReview` / `extractJson` / `ReviewParseError` / `toJsonSchemaFormat` are
  load-bearing and carry over unchanged** (`reviewer.ts:55-113`). The fence/brace recovery
  is what makes `anthropic/claude-*` viable under emulated strict output. Keep their tests.
- **The real per-review cost cap is `maxOutputTokens` + a byte-bounded input diff.**
  `stopWhen: [maxCost(<dollars>), maxTokensUsed(<n>)]` are between-step `StopCondition`s; with
  no tools the single generation completes before they are ever evaluated, so they do **not**
  bound this design's spend (keep them only as future-proofing for a tools variant). Set
  `maxOutputTokens` on the `callModel` request as the generation ceiling, and size the
  compute-diff byte budget to a cost target (input tokens ≈ bytes / 4; pick a budget whose
  input + `maxOutputTokens` cost stays under the documented per-review figure). Wall-clock is
  bounded by `signal: AbortSignal.timeout(<ms>)` and `timeout-minutes` on the job.
  `stepCountIs` / `allowFinalResponse` are irrelevant with no tools — do not set them.
- **`getUsage()` before reporting cost, and it never throws** — call it after `getText()`
  resolves; treat `cost === undefined` as "cost unavailable" in the footer, not an error.
- **The diff is a string, byte-bounded at compute time.** The compute-diff step runs under
  `LC_ALL=C`, truncates to a byte budget sized per the cost target above (comfortably under
  the 1 MB `$GITHUB_OUTPUT` cap), and appends
  `\n\n[diff truncated — NNN of MMM bytes shown]\n`. It reaches the CLI via `--diff` (no temp
  file anywhere); the CLI passes it straight through. Oversized-PR handling beyond truncation
  is out of scope.
- **Never let the key reach a log.** `OPENROUTER_API_KEY` is set as `env:` on the single CLI
  `run:` step inside the composite action, never job-level. The CLI already writes progress
  to stderr without the key; confirm the new logging and error paths (`getUsage`,
  `ReviewParseError.rawResponse`, the gate step's `::error::` annotation) do not echo it.

---

## Phase 1: Scored contract + single-call reviewer + CLI + Markdown output

### Overview

Replace the `findings[] + verdict` contract with a general assessment plus 5 scored criteria;
add a pure `decide()` function; rewrite `reviewer.ts` as one tool-less bounded model call over
PR title + description + diff; replace the terminal renderer with a Markdown renderer; and
give the CLI the flags / JSON result-file / exit model the composite action consumes. The
schema and every module that imports it change together so the package keeps compiling under
`noEmitOnError`. `tools.ts` and the file-reader fixtures stay in-tree, unreferenced, until
Phase 2.

### Changes Required:

#### 1. Review schema

**File**: `packages/code-reviewer/src/schemas.ts`

**Intent**: Swap the old contract for the scored one. The general assessment is a holistic,
cross-cutting evaluation of the whole change (not scoped to one criterion); the 5 criteria
are a fixed-key object so strict output structurally guarantees all 5 are present.

**Contract**: Remove `severitySchema`, `categorySchema`, `findingSchema`, `verdictSchema` and
their exported types. New shape (every field required; `.nullable()` never `.optional()`;
`.describe()` on every leaf so the model gets guidance; `.min(1).max(10)` on `score` is
present so `reviewSchema.parse()` enforces the range — the provider ignores it under emulated
strict mode, but omitting it means nothing rejects `score: 0` or `score: 15`):

```ts
export const criterionNoteSchema = z.object({
  file: z.string(), // path relative to repo root, or "" if not file-specific
  line: z.number().int().positive().nullable(),
  observation: z.string().min(1),
  suggestion: z.string().nullable(),
});

export const criterionScoreSchema = z.object({
  score: z
    .number()
    .int()
    .min(1)
    .max(10) // 1..10 (1 = worst). Provider ignores min/max under emulated
    .describe("1–10, 1 = worst"), // strict mode; reviewSchema.parse() is the only runtime enforcement
  rationale: z.string().min(1),
  notes: z.array(criterionNoteSchema), // may be empty
});

export const reviewSchema = z.object({
  summary: z.string().min(1), // one-sentence headline verdict
  assessment: z.string().min(1), // 3-6 sentence general assessment: architecture-level and cross-cutting observations, overall risk
  criteria: z.object({
    pr_clarity: criterionScoreSchema,
    minimal_readable: criterionScoreSchema,
    tested: criterionScoreSchema,
    input_safety: criterionScoreSchema,
    secrets_authz: criterionScoreSchema,
  }),
});
```

Add a `CRITERION_IDS` const tuple and a `CRITERION_LABELS` / `CRITERION_GROUPS`
(`general` | `security`) map for the renderer and the decision module. Export
`Review`, `CriterionScore`, `CriterionNote`, `CriterionId` types.

#### 2. Decision module

**File**: `packages/code-reviewer/src/decide.ts` (new)

**Intent**: Pure function: given a parsed review and a `failBelow` threshold, return the
pass/fail decision, the minimum score, and which criteria are below the floor. Hard-floor
rule across all 5 criteria — the general assessment does not affect the decision.

**Contract**:

```ts
export interface Decision {
  decision: "pass" | "fail";
  failBelow: number; // echoed back for rendering
  minScore: number;
  failing: CriterionId[]; // criteria with score < failBelow, in CRITERION_IDS order
}
export function decide(review: Review, failBelow: number): Decision;
```

`decision` is `"fail"` iff `failing.length > 0` (i.e. `minScore < failBelow`). `failBelow`
default of `5` lives in the CLI, not here. No clamping of `failBelow` itself; callers pass a
validated integer.

#### 3. Reviewer engine

**File**: `packages/code-reviewer/src/reviewer.ts`

**Intent**: Collapse the agentic flow to a single structured `callModel` with no tools. Inputs
are the PR title, description, and diff, assembled into a labelled prompt. Cap the generation,
bound wall-clock, and capture usage. Return the review together with usage so the CLI can log
cost.

**Contract**:

- `ReviewRequest` becomes `{ prTitle: string; prDescription: string; diff: string }`. Drop
  `rootDir`, `files`, `context`.
- `ReviewerOptions` keeps `client?`, `apiKey?`, `model?`, `strict?`; drop `maxSteps`. Add
  `maxOutputTokens?` (default `8_000` — the real generation cap) and `timeoutMs?` (default
  `300_000`). `maxCostUsd?` (default `0.5`) / `maxTokens?` (default `200_000`) are passed to
  `stopWhen` but **inert for this single-call design** — kept only for a future tools variant.
- `INSTRUCTIONS` rewritten for the 5-criterion scored contract: describe each criterion and
  its sub-checks (lift verbatim from `requirements.md:17-29`), the 1–10 scale with 1 = worst,
  "score every criterion even if the diff doesn't obviously touch it — a criterion with
  nothing to flag scores high", "notes name a concrete file and line from the diff",
  "output ONLY the final JSON review object, no prose, no code fences".
- `review()`:
  - throws if `diff.trim()` is empty (mirrors the old empty-`files` guard).
  - prompt assembled as labelled sections: `## PR title`, `## PR description`
    (or `_(none provided)_`), `## Diff` fenced.
  - `client.callModel({ model, instructions: INSTRUCTIONS, input: prompt,
maxOutputTokens,
provider: { requireParameters: true },
stopWhen: [maxCost(maxCostUsd), maxTokensUsed(maxTokens)],
text: { format: toJsonSchemaFormat(reviewSchema, "code_review", strict) } },
{ signal: AbortSignal.timeout(timeoutMs) })` — **no `tools`**. `provider.requireParameters`
    is camelCase (confirmed `providerpreferences.d.ts:118`); if a later SDK bump removes it,
    fall back to `plugins: [{ id: "response-healing" }]`.
  - returns `{ review: parseReview(await run.getText()), usage: await run.getUsage() }`
    (type `{ review: Review; usage: SessionUsageTotals }`; re-export a local `ReviewUsage`
    alias so `index.ts` doesn't leak the SDK type name).
- `toJsonSchemaFormat`, `parseReview`, `extractJson`, `ReviewParseError` — **unchanged**.
- `DEFAULT_MODEL` — unchanged (`process.env.CODE_REVIEWER_MODEL ?? "anthropic/claude-sonnet-4.5"`).

**Note on field placement**: `CallModelInput` spreads `models.ResponsesRequest` keys, so
`provider` and `maxOutputTokens` are request fields; `signal` is an `@openrouter/agent`
option — confirm whether it sits on the request object or the second `callModel` argument
against `async-params.d.ts:77` during implementation. The camelCase `requireParameters` key
is confirmed present, so there is no "verify whether it's accepted" step.

#### 4. Markdown renderer

**File**: `packages/code-reviewer/src/format.ts`

**Intent**: Replace the severity-based terminal renderer with a review renderer keyed to the
scored contract. Keep a plain terminal variant for local runs; add a GitHub-flavoured
Markdown variant for the job log and run summary.

**Contract**:

- `formatReviewMarkdown(review: Review, decision: Decision, usage: ReviewUsage, model: string): string`
  — header line `**AI code review — PASS**` / `**FAIL (min N < fail-below M)**`; a one-line
  `summary`; the `assessment` paragraph; a table `| Criterion | Group | Score | Rationale |`
  with all 5 rows; a `<details><summary>` per criterion that has notes, listing
  `` `file:line` `` + observation + suggestion; a footer
  `_model · N model call(s) · ~T tokens · $C_` (omit `$C` when `usage.cost` is undefined).
- `formatReviewTerminal(review, decision, usage, model): string` — same information, plain
  text, no ANSI required (drop the `x1b[` colour helpers or keep them guarded by `isTTY`).
- Remove `SEVERITY_*`, `VERDICT_LABEL`, and the `Severity` import.

#### 5. CLI

**File**: `packages/code-reviewer/src/cli.ts`

**Intent**: Accept the PR inputs as flags, drive one review, log the rendered review to
stdout, write a machine-readable result file, and use an exit code the composite action's
gate step can reason about.

**Contract**:

- Flags (all via `node:util` `parseArgs`, string-valued unless noted):
  `--pr-title`, `--pr-description`,
  `--diff <string>` **or** `--diff-file <path>` (exactly one required — `--diff` takes the
  diff text directly, which is how the action passes it; `--diff-file` reads a file, for local
  runs and the integration test),
  `--model`, `--fail-below <n>` (default `5`, parsed + validated as an integer in `1..10`),
  `--max-output-tokens <n>` (default `8000` — the generation cap),
  `--max-cost <dollars>` (default `0.5`) / `--max-tokens <n>` (default `200000`) — passed to
  `stopWhen`, inert for this single-call design, kept for a future tools variant,
  `--timeout-ms <n>` (default `300000`), `--format terminal|markdown|json` (default
  `markdown`), `--out <path>` (optional; writes the JSON result), `-h/--help`.
- Behaviour: resolve the diff (`--diff` text, or read `--diff-file`); construct the reviewer
  with the bound options; call `review()`; run `decide(review, failBelow)`; write the chosen
  `--format` rendering to **stdout** (job log); if `--out` is set, write
  `{ decision, failBelow, minScore, failing, summary, assessment, criteria, usage, model }`
  as JSON. Rendering to the run summary is the action's job (F10), not the CLI's.
- **Exit codes** (the action's gate step maps these to job outcome):
  - `0` — review completed and `decision: "pass"`.
  - `1` — review completed and `decision: "fail"` (at least one criterion below `fail-below`).
  - `2` — bad usage / missing `OPENROUTER_API_KEY`.
  - `3` — infra error the review can't recover from: `ReviewParseError`, SDK/network error,
    abort/timeout, empty diff.
    On exit `1` the `--out` file holds the full review (`decision: "fail"`); on exit `2` / `3`,
    if `--out` is set, write `{ decision: "error", error: <message>, model }` so the action has
    a file to read.
- `ReviewParseError` handler prints `error.message` + `--- raw response ---` +
  `error.rawResponse` to **stderr** (never the key).
- `USAGE` text rewritten for the new flags and exit codes.

#### 6. Barrel exports

**File**: `packages/code-reviewer/src/index.ts`

**Intent**: Export the new surface, drop the removed one.

**Contract**: Remove `severitySchema`, `categorySchema`, `findingSchema`, `verdictSchema`,
`Severity`, `Category`, `Finding`, `Verdict`, `createFileReader`, `createFileTools`,
`FileReader` (`tools.ts` stays in the tree but stops being exported — deleted in Phase 2). Add
`criterionNoteSchema`, `criterionScoreSchema`, `CRITERION_IDS`, `CRITERION_LABELS`,
`CRITERION_GROUPS`, `decide`, `Decision`, `formatReviewMarkdown`, `formatReviewTerminal`,
`ReviewUsage`, and the new types.

#### 7. Schema + decision + renderer + fake-client tests

**File**: `packages/code-reviewer/test/schemas.test.ts` (new),
`packages/code-reviewer/test/decide.test.ts` (new),
`packages/code-reviewer/test/format.test.ts` (new),
`packages/code-reviewer/test/reviewer.test.ts` (rewrite the fake-client suite)

**Intent**: Lock the contract, the decision boundary, the renderer, and the request assembly.

**Contract**:

- `schemas.test.ts` — a valid full review parses; a review missing one criterion key →
  `ReviewParseError` (via `parseReview`); an out-of-range `score` (0, 11) → `ReviewParseError`;
  `toJsonSchemaFormat(reviewSchema, "code_review", true)` emits `type: "object"`, no `$schema`,
  and `criteria` with all 5 keys in `required`.
- `decide.test.ts` — truth table around the threshold: all scores `= failBelow` → `pass`
  (boundary is `<`, not `<=`); one score `= failBelow - 1` → `fail` with that criterion in
  `failing`; `minScore` and `failing` order correct with several below the floor.
- `format.test.ts` — `formatReviewMarkdown` emits a 5-row score table and a PASS / FAIL
  header; the cost footer is omitted when `usage.cost` is undefined.
- `reviewer.test.ts` — `cannedReview` rewritten to the new `Review` shape (low `input_safety`
  / `secrets_authz`, high others, one note each). Fake-client request assertions:
  `request.input` contains the PR title and the diff, `request.tools` is **undefined**,
  `request.provider` is set (`requireParameters`), `request.maxOutputTokens` is set,
  `request.text.format.type === "json_schema"`. Keep the fence/prose recovery test and the
  schema-break → `ReviewParseError` test; add the empty-diff guard test. Delete the
  `createFileReader` describe block (its fixture files are removed in Phase 2).

### Success Criteria:

#### Automated Verification:

- Build passes: `npm --prefix packages/code-reviewer run build`
- Typecheck passes: `npm --prefix packages/code-reviewer run typecheck`
- Package tests pass: `npm --prefix packages/code-reviewer test`
- Prettier clean: `npm --prefix packages/code-reviewer exec prettier -- --check .`
- `node packages/code-reviewer/dist/cli.js --help` prints the new usage and exits `0`
- `grep -rn "verdict\|findings\b\|Severity\|createFileReader" packages/code-reviewer/src` returns nothing outside `tools.ts`

#### Manual Verification:

- `toJsonSchemaFormat(reviewSchema, "code_review", true)` output, eyeballed, is a shape a
  strict `json_schema` provider will accept (all keys in `required`, `additionalProperties:false`,
  no `$schema`; `minimum`/`maximum` present but not relied on).
- The `.describe()` text on `score` and each criterion reads as usable model guidance.
- Local smoke: `node dist/cli.js --pr-title T --pr-description D --diff "$(git diff HEAD~1)" --format markdown --out r.json`
  → readable review to stdout, `r.json` well-formed; exit `0` for a clean diff, `1` for a diff
  that scores a fail, and `3` under `--timeout-ms 1`.

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation before proceeding.

---

## Phase 2: Remove agent tooling, diff-fixture integration test, package docs

### Overview

With the scored contract and the single-call reviewer landed, delete the now-dead agent
tooling and its fixtures, convert the opt-in real-model test from "review a file" to "review a
diff", and add the package README. No `src/` behaviour changes.

### Changes Required:

#### 1. Delete the agent tooling

**File**: `packages/code-reviewer/src/tools.ts` (delete),
`packages/code-reviewer/test/fixtures/insecure-login.ts` (delete),
`packages/code-reviewer/test/fixtures/db.ts` (delete)

**Intent**: Nothing reads files any more.

**Contract**: Remove the files. `reviewer.ts` already dropped the `import { createFileTools }`
line in Phase 1; confirm nothing else references them:
`grep -rn "tools\.js\|createFileTools\|createFileReader\|fixtures/insecure-login\.ts\|fixtures/db" packages/code-reviewer/src packages/code-reviewer/test`
returns nothing.

#### 2. Diff fixture + integration test

**File**: `packages/code-reviewer/test/fixtures/insecure-login.diff` (new),
`packages/code-reviewer/test/reviewer.test.ts`

**Intent**: Convert the opt-in real-model test to a diff review.

**Contract**:

- `insecure-login.diff` — a unified-diff fixture adding a file with SQL injection + plaintext
  password + hardcoded token (same defects as the old `insecure-login.ts`).
- The `describe.skipIf(!process.env.OPENROUTER_RUN_INTEGRATION)` test: read the fixture, call
  `review()` with a real client, assert `reviewSchema.parse(review)` round-trips,
  `criteria.input_safety.score <= 3`, and some `input_safety` note mentions injection.

#### 3. Package README

**File**: `packages/code-reviewer/README.md` (new), `packages/code-reviewer/.env.example`,
`packages/code-reviewer/package.json`

**Intent**: Keep the ancillary files honest with the new CLI.

**Contract**: `.env.example` unchanged (`OPENROUTER_API_KEY` + optional `CODE_REVIEWER_MODEL`).
`package.json` — leave scripts, bump nothing. Add a short `README.md`: what the package does,
the CLI synopsis (`--diff` / `--diff-file`, `--fail-below`, exit codes), the env vars, and
"run `npm run build` before invoking `dist/cli.js`".

### Success Criteria:

#### Automated Verification:

- Build passes: `npm --prefix packages/code-reviewer run build`
- Typecheck passes: `npm --prefix packages/code-reviewer run typecheck`
- Package tests pass: `npm --prefix packages/code-reviewer test`
- Prettier clean: `npm --prefix packages/code-reviewer exec prettier -- --check .`
- No dangling references: `grep -rn "createFileTools\|createFileReader\|tools\.js\|verdict\|findings\b" packages/code-reviewer/src` returns nothing

#### Manual Verification:

- With a real key in `packages/code-reviewer/.env`:
  `OPENROUTER_RUN_INTEGRATION=1 npm --prefix packages/code-reviewer run test:integration`
  passes — a real model call returns a schema-valid scored review of the diff fixture with a
  low `input_safety` score.
- `node dist/cli.js --pr-title "…" --pr-description "…" --diff-file test/fixtures/insecure-login.diff --format markdown --out r.json`
  prints a readable review, writes a well-formed file, and exits `1` (fail) — not `3`.

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation before proceeding.

---

## Phase 3: CI wiring — composite action + workflow

### Overview

Add the repo's first composite action to run the reviewer, and a thin `pull_request` workflow
that computes the diff and calls it. The review goes to the job log and the run summary; a
failing review fails the job. Document the manual `OPENROUTER_API_KEY` secret and the
required-status-check step.

### Changes Required:

#### 1. Composite action

**File**: `.github/actions/ai-code-review/action.yml` (new)

**Intent**: Encapsulate "build the package, test it, run one review, decide the job outcome"
so the workflow stays a few lines. First composite action in the repo.

**Contract**:

- `name`, `description`. `inputs`: `openrouter-api-key` (required), `pr-title` (required),
  `pr-description` (default `""`), `diff` (required — the possibly-truncated diff text),
  `fail-below` (default `"5"`), `model` (default `"anthropic/claude-sonnet-4.5"`),
  `max-output-tokens` (default `"8000"`), `max-cost` (default `"0.5"`),
  `timeout-ms` (default `"300000"`).
- `runs.using: "composite"`, `steps` (every `run:` has `shell: bash`; the npm steps set
  `working-directory: packages/code-reviewer` — a repo-local action shares the caller's
  checkout and composite steps already default the workspace root, so no `../../../`
  traversal, F7):
  1. `uses: actions/setup-node@v5` with `node-version: 24`, `cache: npm`,
     `cache-dependency-path: packages/code-reviewer/package-lock.json`.
  2. `run: npm ci` (`working-directory: packages/code-reviewer`).
  3. `run: npm run build` (same) — produces `dist/`.
  4. `run: npm test` (same) — the package's vitest suite (schemas / decide / format /
     fake-client reviewer). Deps are already installed; this is the **only** CI exercise the
     package that gates every PR gets (F6), and a regression here fails the job.
  5. **Review step** (`id: review`) — with `set +e +o pipefail` at the top:
     `node packages/code-reviewer/dist/cli.js --pr-title "$PR_TITLE"
--pr-description "$PR_DESCRIPTION" --diff "$DIFF" --model "$MODEL"
--fail-below "$FAIL_BELOW" --max-output-tokens "$MAX_OUTPUT_TOKENS" --max-cost "$MAX_COST"
--timeout-ms "$TIMEOUT_MS" --format markdown --out "$RUNNER_TEMP/review.json"
| tee -a "$GITHUB_STEP_SUMMARY"`, then
     `echo "code=${PIPESTATUS[0]}" >> "$GITHUB_OUTPUT"`. The step itself exits `0`; `tee`
     puts the Markdown review in **both** the job log and the run summary (F10).
     `env:` on **this step only**: `OPENROUTER_API_KEY: ${{ inputs.openrouter-api-key }}`,
     `DIFF: ${{ inputs.diff }}`, plus `PR_TITLE` / `PR_DESCRIPTION` / `MODEL` / `FAIL_BELOW` /
     `MAX_OUTPUT_TOKENS` / `MAX_COST` / `TIMEOUT_MS` from the matching inputs — all via env,
     never interpolated into the script body.
  6. `run:` `cat "$RUNNER_TEMP/review.json" || true` — the machine-readable result in the log
     next to the rendered review, for when comment/labels are unparked.
  7. **Gate step** — on `steps.review.outputs.code`:
     - `1` → `echo "::error::AI code review failed (a criterion scored below fail-below=$FAIL_BELOW)"`
       then `exit 1`. **This fails the job**; with the required status check it blocks the PR
       (F9).
     - `2` or `3` → `echo "::error::AI code review could not run (CLI exit <code>)"` then
       `exit 0` — annotated on the PR checks surface but **not blocking** (fail-open on infra,
       F9).
     - `0` → `exit 0`.
- No `outputs:` block for the workflow to consume. No `permissions:` / `secrets:` (composite
  actions can't declare them).

#### 2. Workflow

**File**: `.github/workflows/ai-code-review.yml` (new)

**Intent**: Trigger the review on every PR to `master`, compute a byte-bounded diff, hand off
to the action.

**Contract**:

```yaml
name: AI code review
on:
  pull_request:
    branches: [master]
    types: [opened, synchronize, reopened]
permissions:
  contents: read
concurrency:
  group: ai-cr-${{ github.event.pull_request.number }}
  cancel-in-progress: true
jobs:
  review:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v5
        with: { fetch-depth: 0 }
      - id: diff
        shell: bash
        env:
          BASE_REF: ${{ github.base_ref }} # via env, not interpolated into the script body (F8)
        run: |
          set -euo pipefail
          export LC_ALL=C                     # bytes == chars, so truncation + marker are byte-accurate (F5)
          git fetch --no-tags origin "$BASE_REF"
          DELIM="OCR_$(openssl rand -hex 12)"
          BUDGET=300000                       # ~75K input tokens; keeps per-review cost near $0.20 and the
                                              # --diff argv value well under ARG_MAX and the 1 MB output cap
          FULL="$(git diff --merge-base "origin/$BASE_REF" HEAD)"
          TOTAL=${#FULL}
          BODY="${FULL:0:BUDGET}"
          if [ "$TOTAL" -gt "$BUDGET" ]; then
            BODY="${BODY}"$'\n\n'"[diff truncated — ${BUDGET} of ${TOTAL} bytes shown]"
          fi
          { echo "diff<<$DELIM"; printf '%s\n' "$BODY"; echo "$DELIM"; } >> "$GITHUB_OUTPUT"
      - uses: ./.github/actions/ai-code-review
        with:
          openrouter-api-key: ${{ secrets.OPENROUTER_API_KEY }}
          pr-title: ${{ github.event.pull_request.title }}
          pr-description: ${{ github.event.pull_request.body }}
          diff: ${{ steps.diff.outputs.diff }}
```

- No `labeled` trigger — the `ai-cr:review` retry is parked with the rest of the label
  lifecycle. Re-running is done via the Actions UI "Re-run jobs" button.
- `fetch-depth: 0` so `git diff --merge-base` has both sides.
- The diff travels as a **string** compute-diff → `$GITHUB_OUTPUT` → action `diff` input →
  CLI `--diff` — no temp file anywhere (F5).
- If `secrets.OPENROUTER_API_KEY` is unset the CLI exits `2` and the gate step annotates and
  passes (fail-open on infra) — so the required check does not wedge the repo before the
  secret is set, but a real review only starts once it is.

#### 3. Operator documentation

**File**: `README.md` (repo root — the "CI" or "Available Scripts" area), `context/changes/ai-code-review/change.md`

**Intent**: Record the manual steps and the gate's behaviour.

**Contract**: A short "AI code review" subsection in the repo README:

- `gh secret set OPENROUTER_API_KEY` once (value from OpenRouter).
- Make the check required once a couple of PRs have exercised it: add the `review` context via
  Settings → Branches, or
  `gh api -X PATCH repos/mjedrasz/bikefit/branches/master/protection/required_status_checks --input -`.
  Until then the job runs and fails on a bad review but does not block merges.
- The gate is **blocking on review quality** (`decision: fail` fails the job) and
  **fail-open on infra** (outage / missing key / parse failure → annotated, not blocking).
- Fork PRs are **not supported** (no secrets under `pull_request`).
- PR comment + labels + on-demand retry are a planned follow-up.

Set `change.md` `updated: <implementation date>` (leave `status` for `/10x-implement` to
advance).

### Success Criteria:

#### Automated Verification:

- Workflow + action YAML are valid:
  `npx --yes @action-validator/cli .github/workflows/ai-code-review.yml` exits 0
- Action YAML parses:
  `python3 -c "import yaml,sys; yaml.safe_load(open('.github/actions/ai-code-review/action.yml'))"`
- `actionlint .github/workflows/ai-code-review.yml` clean (shellcheck on the embedded diff +
  gate scripts catches quoting bugs), if `actionlint` is available
- Root CI still green: `npm run lint && npx tsc --noEmit && npm test` (packages/ still
  excluded — unchanged)
- `git grep -n "ai-cr:" .github/` returns nothing (labels fully parked)

#### Manual Verification:

- `gh secret set OPENROUTER_API_KEY` done once on `mjedrasz/bikefit`.
- Push a branch with a small safe change, open a PR to `master`: the **AI code review**
  workflow runs, finishes in a few minutes; the `review` job log **and the run summary** show
  the rendered Markdown review (general assessment + 5-row score table) and the `review.json`
  dump with `decision: "pass"`; job green.
- Open a second PR whose diff adds an unvalidated request body / a hardcoded token: low
  `input_safety` / `secrets_authz` scores, `decision: "fail"`, a `::error::` annotation, and
  the **job fails**.
- Temporarily unset the secret (or point `--model` at a bad slug): the job shows a `::error::`
  annotation and **still passes** (fail-open on infra).
- After adding the `review` context to `master` branch protection: the failing-review PR
  shows "Merge blocked"; a repo admin can still override.
- Confirm no `OPENROUTER_API_KEY` value appears anywhere in the job log (review step,
  `cat review.json` step, gate-step annotation).
- Push a second commit to an open PR: the in-progress run is cancelled by the `concurrency`
  group and a fresh run starts.

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation. This is the last phase.

---

## Testing Strategy

### Unit Tests (package-local vitest — now also run by the review action, F6):

- `schemas.test.ts` — valid review round-trips; missing criterion key → `ReviewParseError`;
  out-of-range score (0 / 11) → `ReviewParseError`; `toJsonSchemaFormat` shape (all keys
  required, no `$schema`).
- `decide.test.ts` — threshold boundary (`= failBelow` passes, `< failBelow` fails);
  `minScore` and `failing` correctness with multiple sub-floor scores.
- `reviewer.test.ts` — fake-client request assembly (title + diff in `input`, no `tools`,
  `provider.requireParameters` set, `maxOutputTokens` set); fence/prose recovery; schema-break
  → `ReviewParseError`; empty-diff guard.
- `format.test.ts` — Markdown renderer emits a 5-row table and a PASS/FAIL header; cost footer
  omitted when `usage.cost` is undefined.

### Integration Test (opt-in, real model call — Phase 2):

- `OPENROUTER_RUN_INTEGRATION=1` — review `insecure-login.diff`, assert schema round-trip and
  `input_safety.score <= 3`.

### Manual Testing Steps:

1. Local CLI smoke: `npm run build` then
   `node dist/cli.js --pr-title T --pr-description D --diff-file test/fixtures/insecure-login.diff --out r.json`
   → readable review to stdout, `r.json` well-formed, exit `1` (fail).
2. Timeout: run with `--timeout-ms 1` → `decision: "error"`, exit `3`, fast.
3. End-to-end in GitHub: the Phase 3 Manual Verification steps (clean PR → pass / green,
   unsafe PR → fail / red, infra error → annotated / green, no key in log).

## Performance Considerations

- One model call per PR event. The cost ceiling is `--max-output-tokens` (8k ≈ ~$0.12 output
  at Sonnet rates) plus the input diff, which the compute-diff step caps at ~300 KB
  (≈ 75K tokens ≈ ~$0.22 input) — so a worst case near **$0.35 per review**, not the `$0.50`
  `--max-cost` figure (inert for a single call — see Critical Implementation Details).
  Wall-clock is bounded by `--timeout-ms` (5 min) and `timeout-minutes: 10` on the job.
- `concurrency` with `cancel-in-progress` abandons a stale run when a new commit lands, so a
  burst of pushes costs one review, not one per push.
- `npm ci` + `npm run build` + `npm test` in the action add ~40–70 s per run; `cache: npm`
  keyed on the package lockfile keeps the install warm.

## Migration Notes

- No data migration. `dist/` stays gitignored and is built per-run.
- The old `Review` shape (`verdict` / `findings`) has no persisted consumers — the package
  was added days ago and is not imported by the app (`src/`).
- Reverting is: delete the two `.github` files, remove the `review` context from `master`
  branch protection, and (optionally) delete the repo secret. The package changes are inert
  without the workflow.

## References

- Research: `context/changes/ai-code-review/research.md`
- Requirements: `context/changes/ai-code-review/requirements.md`
- Current contract: `packages/code-reviewer/src/schemas.ts:65-76`
- Recovery path to preserve: `packages/code-reviewer/src/reviewer.ts:55-113`
- SDK surface: `packages/code-reviewer/node_modules/@openrouter/agent/esm/lib/model-result.d.ts`
  (`getUsage` `:1326-1338`), `.../lib/async-params.d.ts:77` (`signal`),
  `.../lib/stop-conditions.d.ts` (`maxCost` / `maxTokensUsed` are between-step conditions),
  `packages/code-reviewer/node_modules/@openrouter/sdk/.../responsesrequest.d.ts:171`
  (`maxOutputTokens`), `.../providerpreferences.d.ts:118` (`requireParameters`)
- Step-scoped-secrets precedent: `.github/workflows/ci.yml:49-56` (origin:
  `context/archive/2026-09-05-testing-quality-gates-e2e-smoke/reviews/impl-review.md:66-74`)
- CI-gate wiring precedent: `context/archive/2026-09-03-testing-llm-and-ownership/plan.md:783-866`
- Lessons: `context/foundation/lessons.md` (`z.treeifyError`, `npx tsc --noEmit`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Scored contract + single-call reviewer + CLI + Markdown output

#### Automated

- [x] 1.1 Build passes: `npm --prefix packages/code-reviewer run build` — fd0079f
- [x] 1.2 Typecheck passes: `npm --prefix packages/code-reviewer run typecheck` — fd0079f
- [x] 1.3 Package tests pass: `npm --prefix packages/code-reviewer test` — fd0079f
- [x] 1.4 Prettier clean: `npm --prefix packages/code-reviewer exec prettier -- --check .` — fd0079f
- [x] 1.5 `node packages/code-reviewer/dist/cli.js --help` prints the new usage and exits 0 — fd0079f
- [x] 1.6 `grep -rn "verdict\|findings\b\|Severity\|createFileReader" packages/code-reviewer/src` returns nothing outside `tools.ts` — fd0079f

#### Manual

- [x] 1.7 `toJsonSchemaFormat` output eyeballed as strict-`json_schema`-acceptable — fd0079f
- [x] 1.8 `.describe()` guidance on `score` and criteria reads as usable model guidance — fd0079f
- [x] 1.9 Local CLI smoke: readable review to stdout, `--out` file well-formed; exit 0 clean / 1 fail / 3 under `--timeout-ms 1` — fd0079f

### Phase 2: Remove agent tooling, diff-fixture integration test, package docs

#### Automated

- [x] 2.1 Build passes: `npm --prefix packages/code-reviewer run build`
- [x] 2.2 Typecheck passes: `npm --prefix packages/code-reviewer run typecheck`
- [x] 2.3 Package tests pass: `npm --prefix packages/code-reviewer test`
- [x] 2.4 Prettier clean: `npm --prefix packages/code-reviewer exec prettier -- --check .`
- [x] 2.5 No dangling references: `grep -rn "createFileTools\|createFileReader\|tools\.js\|verdict\|findings\b" packages/code-reviewer/src` returns nothing

#### Manual

- [x] 2.6 `test:integration` passes with a real key — scored review of the diff fixture, low `input_safety`
- [x] 2.7 Local CLI run against `insecure-login.diff` → readable review, `--out` well-formed, exit 1 (fail) not 3

### Phase 3: CI wiring — composite action + workflow

#### Automated

- [ ] 3.1 Workflow + action YAML valid (`@action-validator/cli`) exits 0
- [ ] 3.2 Action YAML parses as valid YAML (`python3 -c "import yaml; yaml.safe_load(...)"`)
- [ ] 3.3 `actionlint` clean on the workflow + action (shellcheck on embedded scripts), if available
- [ ] 3.4 Root CI still green: `npm run lint && npx tsc --noEmit && npm test`
- [ ] 3.5 `git grep -n "ai-cr:" .github/` returns nothing

#### Manual

- [ ] 3.6 `gh secret set OPENROUTER_API_KEY` done once on `mjedrasz/bikefit`
- [ ] 3.7 Clean PR → workflow runs, log + run summary show Markdown review + `review.json` `decision: "pass"`, job green
- [ ] 3.8 Unsafe-diff PR → low security scores, `decision: "fail"`, `::error::` annotation, job fails
- [ ] 3.9 Infra error (unset secret / bad model slug) → `::error::` annotation, job passes (fail-open)
- [ ] 3.10 `review` context added to `master` branch protection → failing-review PR shows "Merge blocked"
- [ ] 3.11 No `OPENROUTER_API_KEY` value anywhere in the job log
- [ ] 3.12 Second commit on an open PR cancels the in-progress run via `concurrency`
