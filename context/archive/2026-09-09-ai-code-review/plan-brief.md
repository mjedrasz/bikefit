# AI Code-Review CI/CD Workflow — Plan Brief

> Full plan: `context/changes/ai-code-review/plan.md`
> Research: `context/changes/ai-code-review/research.md`
> Requirements: `context/changes/ai-code-review/requirements.md`

## What & Why

`packages/code-reviewer/` was added days ago as a standalone agentic reviewer but is wired to
nothing. This change turns it into a GitHub-shaped review tool and runs it on every pull
request to `master`: a thin workflow computes the PR diff, hands off to the repo's first
composite action, and a single OpenRouter model call scores the change against 5 criteria
(`pr_clarity`, `minimal_readable`, `tested`, `input_safety`, `secrets_authz`) 1–10 plus a
holistic general assessment. For this iteration the review is printed to the **Actions job
log** — no PR comment, no labels.

## Starting Point

The package today runs an _agentic_ flow: it gives the model `list_files` / `read_file` tools
and asks for a `{ summary, verdict, findings[] }` review. It has a CLI, a terminal renderer,
and a fake-client vitest suite. As of `7d8924e` it is fully walled off from root tooling
(`tsconfig`/`eslint`/`prettier` all exclude `packages/`), which also means it has **zero CI
coverage**. The repo has one workflow (`ci.yml`), no composite actions, no `OPENROUTER_API_KEY`
secret, and only the 9 default GitHub labels.

## Desired End State

Opening or updating a PR to `master` runs an **AI code review** job that finishes in a few
minutes and writes the full scored review to its log **and the run summary**: general
assessment, a 5-row score table, per-criterion notes with `file:line`, and PASS/FAIL against a
configurable floor (`fail-below`, default 5 — fail if any criterion scores below it). Cost is
bounded by `maxOutputTokens` + a byte-bounded input diff; wall-clock by an `AbortSignal` and
`timeout-minutes`. The gate is **blocking on review quality** — `decision: fail` fails the job
and, via a required status check, blocks the PR — and **fail-open on infra**: an outage,
missing key, or hard parse failure is annotated but does not block. The package builds cleanly
and its tests pass locally and in the review action.

## Key Decisions Made

| Decision                 | Choice                                                                                                                                                                                                                            | Why                                                                                                                                            | Source             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Aggregate pass/fail rule | Hard floor across all 5 criteria: fail if `min(score) < fail-below` (default 5), computed in a pure unit-tested `decide.ts`                                                                                                       | Only rule obviously correct under "1 = worst" and explainable in one sentence                                                                  | Plan               |
| Review model             | Keep `anthropic/claude-sonnet-4.5`, add `provider: { requireParameters: true }` (camelCase — confirmed in the installed SDK type), keep parse-recovery                                                                            | No eval churn; recovery already handles emulated strict output                                                                                 | Plan               |
| Reviewer shape           | **Single** structured `callModel`, no agent tools, full diff in the prompt; delete `tools.ts`                                                                                                                                     | User simplification — keep the reviewer trivial to reason about                                                                                | Plan               |
| Schema                   | Fixed 5-key `criteria` object + top-level `summary` **and** `assessment` (general); `score` is `.int().min(1).max(10)` (parse() enforces; provider ignores)                                                                       | Strict output can't enforce array length or range; a missing key / bad score must fail loudly                                                  | Plan / Research §F |
| CLI ↔ action contract    | CLI takes the diff as a `--diff` string (no temp file), logs Markdown to stdout, writes a JSON result file; exit 0 = pass, 1 = review fail, 2 = bad usage, 3 = infra error. The action's gate step maps exit codes to job outcome | GHA-standard file + exit code; blocking gate needs pass/fail in the exit code                                                                  | Plan               |
| Diff transport           | Computed in a prior workflow step, passed to the action via `$GITHUB_OUTPUT` (byte-truncated under `LC_ALL=C`, budget ~300 KB — well under the 1 MB cap) then straight to CLI `--diff`                                            | User instruction (string from a step output, not a file)                                                                                       | Plan               |
| Cost/time bounds         | `maxOutputTokens` (8k) + ~300 KB input-diff budget as the real cost cap; `AbortSignal` (5 min) + job `timeout-minutes` (10) for wall-clock. `maxCost`/`maxTokensUsed` kept but inert for a single tool-less call                  | `stopWhen` conditions are evaluated _between_ agent steps — never reached for one call; SDK retries 5xx for ~1 h so wall-clock must be bounded | Research §E        |
| Gate strength            | **Blocking on review quality** (`decision: fail` → job fails → required status check blocks the PR); **fail-open on infra** (outage / missing key / parse failure → annotated, not blocking)                                      | User instruction — the gate is obligatory; but the PR author can't fix a third-party outage                                                    | User               |
| PR comment + labels      | **Parked**                                                                                                                                                                                                                        | User instruction — this iteration just triggers the reviewer and logs                                                                          | Plan               |
| Package CI               | The action runs `npm ci` + `npm run build` + `npm test`; still no separate package job, still isolated on its own TS 7 / vitest 5 toolchain                                                                                       | The code that gates every PR needs regression coverage; `npm test` is free once deps are installed (F6)                                        | Plan               |

## Scope

**In scope:** (Phase 1 folds the contract swap and the reviewer/renderer/CLI rewrites into one
phase — they break together under `noEmitOnError` and can't be split)

- Rewrite `schemas.ts` to the scored contract + general assessment; new pure `decide.ts`
- Rewrite `reviewer.ts` as one tool-less bounded model call over PR title + description + diff
- New Markdown renderer in `format.ts`; new CLI flags (`--diff` string), result file, exit model
- Delete `tools.ts`, `createFileReader`/`createFileTools`, and the file-reader fixtures; add
  the diff fixture; rework the opt-in integration test; package README
- First composite action (`.github/actions/ai-code-review/action.yml`) — `npm ci` + build +
  `npm test` + review + a gate step that maps the CLI exit code to job outcome
- New workflow (`.github/workflows/ai-code-review.yml`): triggers, `contents: read`,
  per-PR concurrency, byte-bounded compute-diff step
- Operator docs, including the one-time required-status-check step

**Out of scope:**

- PR comment, labels (`ai-cr:passed`/`ai-cr:failed`/`ai-cr:review`), on-demand label retry
- Branch-protection config beyond adding the one `review` required status check
- Agent tools / repository file reading of any kind
- TypeScript-specific criteria (parked in `requirements.md`)
- npm workspaces, a separate package CI job, toolchain alignment to the monorepo root
- `test-plan.md` §5/§6 edits (a later `/10x-test-plan --refresh`)
- Adding the `OPENROUTER_API_KEY` repo secret (manual prerequisite for the user)

## Architecture / Approach

```
PR to master (opened / synchronize / reopened)
        │
        ▼
.github/workflows/ai-code-review.yml
  ├─ checkout (fetch-depth: 0)
  ├─ compute-diff step:  LC_ALL=C git diff --merge-base → byte-truncate @ ~300 KB → $GITHUB_OUTPUT
  └─ uses: ./.github/actions/ai-code-review   (secret + diff string passed as inputs)
        │
        ▼
.github/actions/ai-code-review/action.yml  (composite)
  ├─ setup-node 24 + npm ci + npm run build + npm test   (working-directory: packages/code-reviewer)
  ├─ node dist/cli.js --pr-title … --diff "$DIFF" --out review.json | tee -a $GITHUB_STEP_SUMMARY
  │     └─ reviewer.ts: one callModel(instructions, title+desc+diff, json_schema, maxOutputTokens, signal)
  │        → parseReview → decide(review, failBelow) → Markdown to stdout+summary, JSON to --out, exit 0/1/2/3
  ├─ cat review.json
  └─ gate step: exit 1 on CLI-exit-1 (review fail → job fails); annotate + exit 0 on 2/3 (infra → fail-open)
```

## Phases at a Glance

| Phase                                                      | What it delivers                                                                                                                                                                                | Key risk                                                                                                                                     |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Scored contract + single-call reviewer + CLI + Markdown | `schemas.ts` (5-key criteria + `assessment`, `.min/.max` score), pure `decide.ts`, tool-less bounded `reviewer.ts`, Markdown `format.ts`, CLI flags / result file / exit model, full unit suite | Big phase — schema + all consumers move together; strict-`json_schema` shape under emulated enforcement; `signal` field placement in the SDK |
| 2. Remove tooling + diff-fixture integration test + docs   | `tools.ts` + fixtures deleted, diff fixture, opt-in real-model test reworked, package README                                                                                                    | Small; just confirm nothing still imports the deleted surface                                                                                |
| 3. CI wiring                                               | Composite action (build + test + review + gate step) + blocking workflow, required-status-check step, operator docs                                                                             | Gate-step exit-code mapping; secret must never reach the log; `$GITHUB_OUTPUT` / `--diff` size                                               |

**Prerequisites:** Phase 3 needs `gh secret set OPENROUTER_API_KEY` on `mjedrasz/bikefit`
(manual, one-time) and, once calibrated, the `review` context added to `master` branch
protection. Phases build on each other in order.
**Estimated effort:** ~3 sessions. Phase 1 is now the bulk of the code.

## Open Risks & Assumptions

- **A blocking AI gate can be flaky.** Model nondeterminism can score the same diff 4 one run
  and 6 the next; with `fail-below: 5` that flips a PR between blocked and mergeable. The
  operator docs recommend watching a few PRs before making the check required, and `--fail-below`
  is tunable. (User's explicit call — F9.)
- `provider: { requireParameters: true }` is the camelCase key confirmed present in the
  installed `@openrouter/sdk` type; `plugins: [{ id: "response-healing" }]` is the fallback if
  a future SDK bump removes it.
- `anthropic/claude-sonnet-4.5` under emulated strict output may still occasionally need the
  fence/brace recovery path — kept deliberately; a hard parse failure surfaces as
  `decision: "error"`, exit `3`, and a fail-open (annotated, non-blocking) job.
- Very large PRs are truncated at the ~300 KB byte budget with a marker — no smarter chunking.
- Fail-open on infra means a silently broken gate (bad key, stale model slug) lets every PR
  through; the `::error::` annotation on the PR checks surface is the mitigation.
- `git diff --merge-base` assumes the PR base ref is fetchable (`fetch-depth: 0` + explicit
  `git fetch origin "$BASE_REF"`).

## Success Criteria (Summary)

- A clean PR to `master` produces an AI-review job whose log + run summary show a schema-valid
  scored review with `decision: "pass"` and a green job; an unsafe-diff PR shows low
  `input_safety`/`secrets_authz` scores, `decision: "fail"`, and a **failed** job (blocking).
- An infra error (missing key, outage, parse failure) annotates the PR and leaves the job
  **green** (fail-open).
- No `OPENROUTER_API_KEY` value appears anywhere in a job log.
- `packages/code-reviewer/` builds and its vitest suite passes locally and in the review
  action; root CI stays green
  and untouched.
