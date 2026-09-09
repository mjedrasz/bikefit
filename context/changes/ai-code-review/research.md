---
date: 2026-09-09T21:52:00+02:00
researcher: maro
git_commit: fc1f69d04cfb89e11d559a5e85b2bdd3b43be5f1
branch: master
repository: bikefit
topic: "AI code-review GitHub Actions workflow — package redesign + CI wiring"
tags: [research, codebase, ci, github-actions, code-reviewer, openrouter, composite-action]
status: complete
last_updated: 2026-09-09
last_updated_by: maro
last_updated_note: "Criteria set reduced from 12 to 5 (3 General + 2 Security, TypeScript dropped) per user decision; §F and Open Questions revised."
---

# Research: AI code-review GitHub Actions workflow

**Date**: 2026-09-09T21:52:00+02:00
**Researcher**: maro
**Git Commit**: fc1f69d04cfb89e11d559a5e85b2bdd3b43be5f1
**Branch**: master
**Repository**: bikefit (`mjedrasz/bikefit`)

## Research Question

Research the `ai-code-review` change against `context/changes/ai-code-review/requirements.md`: an
AI code-review job that runs on every PR to `master`, driven by a thin top-level workflow plus a
composite action, taking PR title + description + git diff as input, scoring 5 review criteria
1–10, and producing a PR comment plus one of two labels (`ai-cr:passed` / `ai-cr:failed`), with an
on-demand retry when `ai-cr:review` is added.

**Scoping decisions taken up front** (user, this session):

- **Review contract**: full redesign around scored criteria — replace the current
  `findings[] + verdict` schema with per-criterion scored blocks (id, score 1–10, rationale,
  evidence/notes).
- **Criteria set**: **5, not 12** — `requirements.md` was revised to 3 General
  (`pr_clarity`, `minimal_readable`, `tested`) + 2 Security (`input_safety`, `secrets_authz`).
  The 4 TypeScript criteria are dropped from v1 (parked — largely covered by the existing
  `tsc --noEmit` + `eslint strictTypeChecked` CI gates).
- **Depth**: both layers equally — the GitHub Actions layer _and_ the package/CLI changes.

## Summary

1. **A first-cut engine already exists.** `packages/code-reviewer/` (added today in `fc1f69d`) is a
   standalone npm project wrapping the **OpenRouter Agent SDK** (`@openrouter/agent@^0.11.0`). It
   gives a model two root-jailed filesystem tools (`list_files` / `read_file`) and forces a
   Zod-validated JSON review (`summary`, `verdict`, `findings[]`). It has a CLI
   (`code-reviewer <file...>`), a terminal renderer, and unit tests with an injected fake client.
   It is **not** wired to CI and has **no** GitHub/Markdown output, no diff input, and no scoring.

2. **CI is red on `master` right now.** The `fc1f69d` commit broke the `ci` job: root
   `npx tsc --noEmit` (`.github/workflows/ci.yml:20`) type-checks `packages/code-reviewer/src/**`
   because root `tsconfig.json` has `include: ["**/*"]`, and fails with
   `Cannot find module '@openrouter/agent'` (no npm workspaces — the package's deps live in its own
   nested `node_modules`) plus two implicit-`any` errors. `lint` / `test` / `build` were skipped by
   the failure; root `eslint .` _also_ fails on the package (~20 `strictTypeChecked` errors).
   **Un-breaking root tooling for `packages/` is a prerequisite for this change**, not optional
   cleanup.

3. **No composite-action precedent.** There is no `.github/actions/`, no `action.yml`, no reusable
   workflow anywhere in the repo. `.github/workflows/ci.yml` is the only workflow. This change adds
   the first composite action.

4. **`pull_request` (not `pull_request_target`) is the right trigger.** Same-repo PRs get repo
   secrets and a write `GITHUB_TOKEN` under `pull_request`. The repo is a solo project
   (`mjedrasz/bikefit`); fork PRs are out of scope and were explicitly dismissed as a concern in a
   prior plan-review (F7, quality-gates). `pull_request_target` carries "pwn request" risk and
   should be avoided.

5. **The redesign touches nearly every file in the package** — `schemas.ts` (new contract),
   `reviewer.ts` (inputs, prompt, cost/timeout guards), `tools.ts` (recursion bug, diff tool),
   `cli.ts` (new flags, output files, exit model), `format.ts` (Markdown renderer),
   `index.ts`, and the whole test suite. Plus two new files outside the package: the composite
   action and the workflow.

6. **Several decisions the requirements leave open** — the aggregate pass/fail rule and threshold,
   whether non-security criteria can block, how the diff enters (prompt vs tool vs both), the
   CLI exit-code model, the review model, and whether to formally isolate the package from root
   tooling. Listed in **Open Questions**; these belong to `/10x-plan`.

## Detailed Findings

### A. The existing `code-reviewer` package (`packages/code-reviewer/`)

Added whole in commit `fc1f69d` ("feat(code-reviewer): add agent-based code review package").
Tracked files: `src/{cli,format,index,reviewer,schemas,tools}.ts`, `test/reviewer.test.ts`,
`test/fixtures/{db,insecure-login}.ts`, `package.json`, `package-lock.json`, `tsconfig.json`,
`tsconfig.build.json`, `vitest.config.ts`, `.prettierrc.json`, `.prettierignore`, `.gitignore`,
`.env.example`. `dist/` is built locally but **gitignored** (root `.gitignore` `dist/`).

**Current review contract** (`packages/code-reviewer/src/schemas.ts`):

| Symbol           | Shape                                                                                                     | Lines              |
| ---------------- | --------------------------------------------------------------------------------------------------------- | ------------------ |
| `severitySchema` | `enum(critical, high, medium, low, info)`                                                                 | `schemas.ts:14-20` |
| `categorySchema` | `enum(security, correctness, performance, maintainability, testing, style, other)`                        | `schemas.ts:23-31` |
| `findingSchema`  | `{ file, line: int.positive().nullable(), severity, category, title, description, suggestion: nullable }` | `schemas.ts:34-59` |
| `verdictSchema`  | `enum(approve, comment, request_changes)`                                                                 | `schemas.ts:62-63` |
| `reviewSchema`   | `{ summary, verdict, findings: array(findingSchema) }`                                                    | `schemas.ts:65-76` |

- **`.nullable()` not `.optional()` everywhere** — deliberate (`schemas.ts:3-12`): the same schema is
  converted to JSON Schema _and_ used to parse output, so every field must round-trip through
  OpenAI-dialect strict structured outputs (which forbids optional keys / requires everything in
  `required[]`). **This constraint carries into the redesign.**
- Zod 4.5.4's `z.toJSONSchema(schema, { target: "draft-2020-12" })` already emits
  `additionalProperties: false` + a full `required[]` when no `.optional()` is used — so the schema
  is already strict-shaped.

**Reviewer** (`packages/code-reviewer/src/reviewer.ts`):

- `createReviewer(options)` (`reviewer.ts:115-154`): `model = options.model ?? DEFAULT_MODEL`,
  `maxSteps = 12`, `strict = true`; client is `new OpenRouter({ apiKey: … ?? process.env.OPENROUTER_API_KEY })`
  (`reviewer.ts:120-124`).
- `DEFAULT_MODEL = process.env.CODE_REVIEWER_MODEL ?? "anthropic/claude-sonnet-4.5"` (`reviewer.ts:37-38`).
- `review(request)` (`reviewer.ts:126-151`): throws on empty `files`; builds `tools = createFileTools(rootDir)`;
  assembles a prompt of `"Review the following file(s)…"` + `- <file>` lines + an optional
  `"Additional context:\n<context>"` block; then:
  ```
  client.callModel({ model, instructions: INSTRUCTIONS, input: prompt.join("\n"),
                     tools, stopWhen: stepCountIs(maxSteps),
                     text: { format: toJsonSchemaFormat(reviewSchema, "code_review", strict) } })
  ```
  and returns `parseReview(await run.getText())`. Only `getText()` is consumed — **no usage / cost
  captured, no `signal`, no `maxCost`**.
- `INSTRUCTIONS` (`reviewer.ts:40-53`): "meticulous senior software engineer", "report a small
  number of high-signal findings", "Never invent problems", "return an approve verdict and an empty
  findings array" when clean, "output ONLY the final JSON review object. No prose, no code fences."
  **This prompt is written for the findings/verdict model and is fully rewritten by the redesign.**
- `toJsonSchemaFormat` (`reviewer.ts:55-66`): `z.toJSONSchema` → **`delete jsonSchema["$schema"]`**
  (OpenRouter rejects the meta key) → `{ type: "json_schema", name, strict, schema }`. **Carries
  over unchanged.**
- `parseReview` / `extractJson` / `ReviewParseError` (`reviewer.ts:68-113`): unwrap a ` ```json ` fence
  or fall back to the substring between the first `{` and last `}`; `safeParse`; `ReviewParseError`
  carries `rawResponse`. **Carries over unchanged** — the recovery path is load-bearing for Claude
  (see §E).

**Agent tools** (`packages/code-reviewer/src/tools.ts`):

- `createFileReader(rootDir)` (`tools.ts:14-55`): `resolveInside()` (`tools.ts:17-23`) is a **lexical**
  path-escape guard (`abs === root || abs.startsWith(root + sep)`), no `fs.realpath` → a symlink
  inside the root pointing out is not caught.
- `IGNORED = /(^|\/)(node_modules|\.git|dist|build|coverage)(\/|$)/` (`tools.ts:25`) — applied to
  `listFiles` output **only**.
- **`listFiles` bug** (`tools.ts:30-43`): `fs.readdir(target, { recursive: true })` walks
  `node_modules` / `.git` / `dist` _before_ `IGNORED` filters the result — on a full repo checkout
  that is tens of thousands of entries per call.
- `createFileTools` (`tools.ts:63-94`) returns `[list_files, read_file] as const`. No `outputSchema`,
  no size guard on `read_file`.

**CLI** (`packages/code-reviewer/src/cli.ts`):

- `process.loadEnvFile()` in try/catch (`cli.ts:10-14`) — loads `.env` from cwd.
- Flags (`cli.ts:38-48`): `--root`, `--model`, `--context`, `--max-steps`, `--json`, `-h`. All
  single-valued. Positionals = files, resolved against cwd then re-expressed relative to `--root`
  (`cli.ts:67-70`).
- **Exit codes** (`cli.ts:93`, `cli.ts:98-109`): `0` = approve/comment, `1` = request_changes
  **or any thrown error**, `2` = bad usage / missing key. `ReviewParseError` prints
  `message + "--- raw response ---" + rawResponse`.
- Output (`cli.ts:87-91`): `--json` → raw JSON to stdout; else `formatReview()` (ANSI) to stdout;
  progress to stderr. **No Markdown / GitHub mode.**

**Formatter** (`packages/code-reviewer/src/format.ts`): pure terminal renderer, ANSI colours,
severity-sorted. `Severity` / `VERDICT_LABEL` / `SEVERITY_*` are all tied to the old schema.

**Tests** (`packages/code-reviewer/test/reviewer.test.ts`, 190 lines): injected `fakeClient`
(`test/reviewer.test.ts:44-51`) returning a fixed string; `cannedReview` in the old shape
(`:16-42`); covers request assembly + json_schema plumbing (`:53-80`), fence/prose recovery
(`:82-95`), schema-break → `ReviewParseError` (`:97-106`), empty-file guard (`:108-114`),
`toJsonSchemaFormat` (`:117-128`), `parseReview` (`:130-144`), `createFileReader` incl.
path-traversal block (`:146-167`), and an **opt-in real-model integration test** gated on
`OPENROUTER_RUN_INTEGRATION` that asserts the planted SQL-injection bug is found (`:170-190`).

**Build / tooling** (`packages/code-reviewer/`):

- `package.json`: `@10x/code-reviewer`, `private`, `type: module`, `engines.node: ">=22"`,
  `bin.code-reviewer → ./dist/cli.js`. Scripts: `review` = `tsx src/cli.ts`, `build` =
  `tsc -p tsconfig.build.json` → `dist/`, `typecheck` = `tsc -p tsconfig.json`, `test` = `vitest run`.
  Deps: `@openrouter/agent ^0.11.0`, `zod ^4.5.4`. DevDeps include **`typescript ^7.0.2`** (the TS 7
  / native-compiler preview line — the monorepo root pins `typescript ^5.9.3`) and **`vitest ^5.0.0`**
  (root is `vitest 4.1.11`).
- `tsconfig.json`: `module/moduleResolution nodenext`, `strict`, `noUncheckedIndexedAccess`,
  `verbatimModuleSyntax`, `noEmit`. `tsconfig.build.json`: `outDir dist`, `rootDir src`,
  `declaration`, `noEmitOnError`, `exclude: ["test", …]`.
- `.prettierrc.json`: `printWidth: 80` (root prettier is `printWidth: 120`).

### B. CI is broken on `master` — root cause and fix options

Latest CI run on `master` (`fc1f69d`, run `34393334975`) **failed**. The `e2e` job passed; the
`ci` job failed at `npx tsc --noEmit`:

```
packages/code-reviewer/src/reviewer.ts(1,41): error TS2307: Cannot find module '@openrouter/agent'
packages/code-reviewer/src/tools.ts(3,22):   error TS2307: Cannot find module '@openrouter/agent'
packages/code-reviewer/src/tools.ts(79,17):  error TS7031: Binding element 'dir' implicitly has an 'any' type
packages/code-reviewer/src/tools.ts(90,17):  error TS7031: Binding element 'file' implicitly has an 'any' type
Process completed with exit code 2
```

`npm run lint` / `npm test` / `npm run build` were **skipped** (bash `-e`), so further breakage may
be latent behind lint.

**Why**: root `tsconfig.json` (`tsconfig.json:3`) has `include: [".astro/types.d.ts", "**/*"]`,
`exclude: ["dist"]` — so `packages/code-reviewer/src/**` and `test/**` are pulled into the root
`npx tsc --noEmit`. The repo has **no npm workspaces** (root `package.json` has no `workspaces`
field), so root `npm ci` never installs the package's `@openrouter/agent` dependency → the import
is unresolvable in CI, which then cascades to implicit-`any` on the untyped `tool()` callbacks.
Locally it passes only because `packages/code-reviewer/node_modules` exists.

**`eslint .` also fails on the package.** `eslint.config.js` derives ignores solely from
`includeIgnoreFile(<root>/.gitignore)` (`eslint.config.js:12`, `:88`), and `.gitignore` has no
`packages/` entry. So `strictTypeChecked` + `stylisticTypeChecked` + `eslint-plugin-prettier` all
apply to `packages/code-reviewer/**`. Locally, `npx eslint packages/code-reviewer/src/reviewer.ts`
reports 2 errors (`@typescript-eslint/dot-notation` at `reviewer.ts:64`,
`@typescript-eslint/prefer-regexp-exec` at `reviewer.ts:100`); a full lint of the package surfaces
~20 (`no-unsafe-*`, `no-non-null-assertion`, `require-await`, …). `prettier --check` on the package
passes (its own config).

`npm test` (root vitest) is **not** affected — `vitest.config.ts:41` scopes `include` to
`src/**/*.{test,spec}.ts`, so `packages/code-reviewer/test/**` never runs under root CI. Neither
does Stryker (`stryker.config.json` `mutate` is 6 explicit `src/lib/**` files).

`lefthook.yml` also does not exclude `packages/` — staged `packages/**/*.ts` get `eslint --fix`
(`lefthook.yml` `lint` glob `*.{ts,tsx,astro,js,jsx}`) and are swept into the unfiltered
`typecheck: npx tsc --noEmit` and `test: vitest related`.

**Fix options** (decision for the plan):

| Option                                           | What                                                                                                                                                                                                                                                          | Trade-off                                                                                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Exclude `packages/**` from root tooling\*\* | Add `packages/` to root `tsconfig.json` `exclude`, add an `ignores` entry in `eslint.config.js`, and add `packages` to root `.prettierignore`. Give the package its own CI job (`npm --prefix packages/code-reviewer ci && … typecheck && … lint && … test`). | Cleanest separation for what is really a separate deliverable. One more CI job. The package's own gates (TS 7, vitest 5) run independently.                       |
| **2. Adopt npm workspaces**                      | Add `"workspaces": ["packages/*"]` to root `package.json`; root `npm ci` then installs the package deps and a project reference can type-check it properly.                                                                                                   | Aligns install; but forces the package onto the root's TS 5.9 / vitest 4 resolution unless carefully split, and pulls `@openrouter/agent` into the root lockfile. |
| **3. Minimal unblock now, isolate later**        | Land a tiny commit that adds `packages/` to root `tsconfig` `exclude` + eslint `ignores` to get `master` green, then do the full wiring in this change.                                                                                                       | Gets CI green immediately; the "isolate vs workspace" decision still has to be made.                                                                              |

Historical precedent favours **narrowly-scoped, secret-free** CI changes reconciled afterward
(see §K), and the quality-gates impl-review (F2) established that **the repo's lint gates are
treated as authoritative even over plan contracts** — a package that fails root lint will be
treated as a blocker.

### C. Existing CI workflow — structure and conventions

`.github/workflows/ci.yml` (63 lines, the only workflow):

- **Triggers** (`ci.yml:3-7`): `push` and `pull_request` on `branches: [master]` only. No
  `workflow_dispatch`, no `labeled` type, no `concurrency` group, no path filters.
- **`ci` job** (`ci.yml:10-26`): checkout@v5 → setup-node@v5 (node **24**, `cache: npm`) → `npm ci`
  → `npx astro sync` → `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build` (the only
  step with `env:` — `SUPABASE_URL` / `SUPABASE_KEY`).
- **`e2e` job** (`ci.yml:28-62`): parallel; its own checkout / setup-node / `npm ci` / `astro sync`;
  `supabase link` + `db push` against the dedicated `bikefit-e2e` project; `playwright install`;
  `playwright test`.
- **Step-scoped secrets are a deliberate least-privilege pattern** (`ci.yml:49-56`): every `env:`
  block is attached to an individual `run:` step, never job-level, because `npm ci` /
  `playwright install` run untrusted third-party install scripts and must not see Supabase keys.
  This was a fix from impl-review (quality-gates F4 — see §K). **The composite action for this
  change should follow the same rule: `OPENROUTER_API_KEY` only on the step that runs the CLI.**
- **Secrets that exist as repo secrets today**: `SUPABASE_URL`, `SUPABASE_KEY`,
  `SUPABASE_ACCESS_TOKEN`, `E2E_SUPABASE_DB_PASSWORD`, `E2E_SUPABASE_URL`, `E2E_SUPABASE_KEY`,
  `E2E_SUPABASE_SERVICE_ROLE_KEY`. **There is no `OPENROUTER_API_KEY` repo secret** — the e2e job
  passes a literal `OPENROUTER_API_KEY: e2e-mock-unused` because the app's LLM calls are mocked
  (`ci.yml:60-62`). This change must add a real `OPENROUTER_API_KEY` repo secret.
- Node: CI uses **24**; `.nvmrc` is `22.14.0`; the package needs `>=22`. Fine either way.

### D. GitHub Actions mechanics for this change

**Composite action** (first in the repo). Authoring shape (current docs):

```yaml
# .github/actions/ai-code-review/action.yml
name: "AI code review"
description: "…"
inputs:
  openrouter-api-key: { required: true }
  fail-below: { default: "5" }
  model: { default: "anthropic/claude-sonnet-4.5" }
runs:
  using: "composite"
  steps:
    - uses: actions/setup-node@v5
      with: { node-version: 24, cache: npm }
    - run: npm ci
      shell: bash
      working-directory: ${{ github.action_path }}/../../../packages/code-reviewer
    # … compute diff, run CLI, post comment, set label …
```

- Referenced from a workflow as `uses: ./.github/actions/ai-code-review` after `actions/checkout`.
- Composite steps need `shell:` on every `run:`. `${{ github.action_path }}` locates the action's
  own directory. Pin any nested `uses:` by tag or SHA.
- Composite actions **cannot** themselves declare `permissions:` or `secrets:` — those live on the
  calling workflow/job; secrets must be passed in as `inputs`.

**Trigger design** — one workflow, two triggers:

```yaml
on:
  pull_request:
    branches: [master]
    types: [opened, synchronize, reopened, labeled]
permissions:
  contents: read
  pull-requests: write # gh pr comment / edit --add-label
  issues: write # labels are issue labels
concurrency:
  group: ai-cr-${{ github.event.pull_request.number }}
  cancel-in-progress: true
jobs:
  review:
    if: >-
      github.event.action != 'labeled' ||
      github.event.label.name == 'ai-cr:review'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with: { fetch-depth: 0 } # need base..head for the diff
      - uses: ./.github/actions/ai-code-review
        with:
          openrouter-api-key: ${{ secrets.OPENROUTER_API_KEY }}
```

- `opened / synchronize / reopened` = "every new PR + every push to it". `labeled` +
  `if: github.event.label.name == 'ai-cr:review'` = the on-demand retry (`requirements.md:49`).
  The retry job should **remove `ai-cr:review`** at the end so it is re-addable
  (`gh pr edit --remove-label ai-cr:review`).
- **`pull_request`, not `pull_request_target`.** Same-repo PRs get `secrets` and a write token
  under `pull_request`; `pull_request_target` runs the base-branch workflow with elevated trust and
  is the classic "pwn request" vector. Fork PRs (which get no secrets under `pull_request`) are out
  of scope for this solo repo — the quality-gates plan-review already dismissed the fork-secrets
  gap as "solo project" (F7, §K). Document that AI review is skipped / neutral on fork PRs.
- `concurrency` per PR number with `cancel-in-progress` so a mid-review push abandons the stale run
  (each review is a paid model call).
- `fetch-depth: 0` (or an explicit `git fetch origin $GITHUB_BASE_REF`) so the action can compute
  `git diff origin/${{ github.base_ref }}...HEAD` and `git diff --name-only …`.

**PR comment + labels** — two idiomatic routes:

- `gh` CLI with `env: { GH_TOKEN: ${{ github.token }} }`: `gh pr comment "$PR_URL" --body-file …`,
  `gh pr edit "$PR_URL" --add-label ai-cr:failed --remove-label ai-cr:passed`. Simplest.
- `actions/github-script@v8` for an **updating** (not duplicating) comment: list
  `issues.listComments`, find one containing an HTML marker like `<!-- ai-code-review -->`,
  `updateComment` if found else `createComment`. Preferred so re-runs don't stack comments.
- **Labels must be created** — the repo has only the 9 GitHub defaults; `ai-cr:passed`,
  `ai-cr:failed`, `ai-cr:review` do not exist. Either pre-create them (one-time
  `gh label create "ai-cr:passed" --color 0e8a16`, `ai-cr:failed --color d73a4a`,
  `ai-cr:review --color fbca04`) or have the action create-if-missing (`gh label create … || true`).
  `requirements.md:45` calls for red (failed) / green (passed).
- Setting `GITHUB_TOKEN`-authored labels does **not** re-trigger the workflow (no `labeled` loop) —
  events raised by the default token don't start new workflow runs.

### E. OpenRouter Agent SDK surface (`@openrouter/agent@0.11.0`)

Read from `packages/code-reviewer/node_modules/@openrouter/agent/{README.md,esm/*.d.ts}`. ESM-only,
Apache-2.0, **explicitly beta** ("pin to a specific version"). Declares `@openrouter/agent` + `zod`;
`@openrouter/sdk@^0.13.7` is transitive.

- **`new OpenRouter({ apiKey })`** — `apiKey` may be a string or `() => Promise<string>`; no env
  auto-read (the package passes `process.env.OPENROUTER_API_KEY` explicitly, `reviewer.ts:123`).
  `serverURL` defaults to `https://openrouter.ai/api/v1`; `timeoutMs` and `retryConfig` are
  available.
- **`callModel(request)`** returns a `ModelResult` ("run"). Consumption methods:
  - `getText(): Promise<string>` — the only one used today.
  - `getResponse()` — final round only; `.usage.cost?: number`.
  - **`getUsage(): Promise<SessionUsageTotals>`** — aggregate across every model call in the run:
    `{ modelCalls, inputTokens, outputTokens, totalTokens, cachedTokens, cost? }`. Never rejects.
    **This is how the redesign should report review cost** (job summary + PR-comment footer).
  - Streaming getters, `cancel()`, hooks (`PostModelCall`, `SessionEnd`).
- **`stopWhen`** — one or an array (OR semantics): `stepCountIs(n)` (default 5), `hasToolCall(name)`,
  `maxTokensUsed(n)`, **`maxCost(dollars)`**, `finishReasonIs(reason)`. Today only
  `stepCountIs(12)`.
- **`allowFinalResponse` defaults ON**: when `stopWhen` fires while the model is still emitting
  tool calls, the loop runs the pending calls then makes one more turn with `toolChoice: 'none'` +
  a "write your final answer now" directive. The current design **silently depends on this** to get
  JSON out when the agent hits `stepCountIs(12)` mid-investigation.
- **`doomLoop` is off by default.** If ever enabled, an agent that re-reads the same files each
  turn trips it at round 3 unless `read_file` gets `loopKey: false`.
- **Strict structured output is NOT enforced by the SDK.** The README is explicit: "The SDK sends
  the generated schema unchanged. Providers validate it according to their own strict-mode
  dialect." Per OpenRouter docs, structured-output support is **per-endpoint, not just per-model** —
  different providers serving the same model vary. Strong native support: OpenAI GPT-4o-2024-08-06+
  / GPT-4.1 / o-series. `anthropic/claude-*` (the current default) supports `json_schema` via
  emulation; strict adherence is best-effort — **which is exactly why `extractJson` / `parseReview`
  recovery exists.** Guards to add: `provider: { require_parameters: true }` on the request (routes
  only to endpoints that honour `response_format`); optionally the first-party
  `plugins: [{ id: "response-healing" }]`.
  - OpenAI-dialect strict mode also **ignores `minimum` / `maximum` / `minItems` / `maxItems`** —
    so a `z.number().int().min(1).max(10)` score is only clamped by the client-side
    `reviewSchema.parse`, and an "exactly 5" array length can't be structurally guaranteed (see §F).
- **Retry danger for a CI gate**: `@openrouter/sdk`'s Responses endpoint defaults to
  `strategy: "backoff"`, `retryCodes: ["5XX"]`, `maxElapsedTime: 3_600_000` — **5XX is retried with
  backoff for up to ~1 hour**. A CI job MUST bound this with `signal` (wall-clock deadline) and/or
  `stopWhen: [maxCost(...), maxTokensUsed(...)]`. 429 is **not** in the default retry set.
- **Error classes** (`@openrouter/sdk/esm/models/errors/`): `BadRequestResponseError` (400 — a
  schema the provider rejects), `UnauthorizedResponseError` (401), `PaymentRequiredResponseError`
  (402 — out of credit), `TooManyRequestsResponseError` (429), 5xx variants,
  `EdgeNetworkTimeoutResponseError` (524), `ProviderOverloadedResponseError` (529). The package
  catches none specifically today — they fall through to `cli.ts:103` and exit 1. The redesign
  needs to distinguish **"review ran, verdict = fail"** from **"review could not run"** (see §H).

### F. The redesigned review contract (5 scored criteria)

The 5 criteria from `requirements.md` (revised this session — was 12), each scored 1–10:

| #   | id                 | group    | Covers                                                                                                                                                                               |
| --- | ------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `pr_clarity`       | general  | title states the change; description covers what / why / how to test; linked issue                                                                                                   |
| 2   | `minimal_readable` | general  | smallest diff, no speculative abstraction / unrelated changes; names say what things are; matches surrounding style; no dead code / stray logs / commented-out blocks                |
| 3   | `tested`           | general  | new logic has tests; changed behaviour updates existing ones; edge + error paths                                                                                                     |
| 4   | `input_safety`     | security | API bodies / params / env parsed with zod before use, never cast raw JSON; parameterised queries only; no `set:html` / `dangerouslySetInnerHTML`; no user input in shell / redirects |
| 5   | `secrets_authz`    | security | keys/tokens from env only, nothing sensitive logged/committed; every protected route/query checks the current user; RLS on new tables                                                |

The 4 TypeScript criteria (`no_any`, `null_safety`, `typed_surfaces`, `async_safety`) are
**parked** — `requirements.md` "Parked for later". They are largely already enforced by the two
existing required CI gates (`npx tsc --noEmit` + `eslint` with `strictTypeChecked` /
`stylisticTypeChecked` — `no-floating-promises`, `no-explicit-any`, `no-unnecessary-condition`,
`switch-exhaustiveness-check`, etc.). The AI review adds little there and would mostly duplicate
lint output. Revisit only if type-safety regressions start slipping past those gates.

**Schema shape — use a fixed object of 5 named keys, not an array.** This is dictated by the
strict-output constraint (§A, §E): strict mode cannot enforce `minItems`, so an `array(criterion)`
lets the model legally return 3 blocks or two with the same `id`. A
`criteria: z.object({ pr_clarity: criterionScoreSchema, minimal_readable: …, … })` with all 5 keys
required + `additionalProperties: false` is **structurally guaranteed** by strict mode and by
Zod 4's emitter, and a missing key becomes a clean `ReviewParseError` rather than a silently short
array.

Suggested block shape (every field required; `null` for "absent" per the `.nullable()` rule):

```ts
criterionScoreSchema = z.object({
  score: z.number().int(), // 1..10, range enforced client-side; describe() it
  rationale: z.string().min(1), // why this score
  notes: z.array(criterionNoteSchema), // per-criterion findings (replaces top-level findings[])
});
criterionNoteSchema = z.object({
  file: z.string(),
  line: z.number().int().positive().nullable(),
  observation: z.string().min(1),
  suggestion: z.string().nullable(),
});
reviewSchema = z.object({
  summary: z.string().min(1),
  criteria: z.object({
    pr_clarity: criterionScoreSchema,
    minimal_readable: criterionScoreSchema,
    tested: criterionScoreSchema,
    input_safety: criterionScoreSchema,
    secrets_authz: criterionScoreSchema,
  }),
});
```

- `verdict` is now **derived, not model-authored** — drop `verdictSchema` from the contract (or
  keep a per-note `blocking: boolean` if useful for comment rendering).
- `severitySchema` / `categorySchema` become dead — category is implied by the criterion.
  Decide whether to keep `severity` on `criterionNoteSchema` (a `score: 3` on `input_safety`
  reads differently from a `score: 7` on `minimal_readable`).
- `toJsonSchemaFormat`, `parseReview`, `extractJson`, `ReviewParseError` — unchanged.

**Aggregate pass/fail — `requirements.md` is silent. Options** (now over 5 criteria: 3 general +
2 security = `input_safety`, `secrets_authz`):

| Rule                                        | Definition                                                                                                                                      | Note                                                                                                                                                |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Hard floor**                           | fail if `min(all 5 scores) < N` (e.g. N = 5)                                                                                                    | Simple, matches "1 = worst"; one bad criterion blocks. Sensitive to model calibration.                                                              |
| **B. Mean threshold**                       | fail if `mean(scores) < T`                                                                                                                      | Smooths noise, but a 2/10 on `input_safety` averages away — bad for a security gate.                                                                |
| **C. Security hard floor + mean elsewhere** | fail if `input_safety < 6` **or** `secrets_authz < 6` **or** `mean(3 general) < 6`                                                              | The 2 security criteria gate; the 3 general ones advise. Two rules to explain.                                                                      |
| **D. Security-only gate**                   | fail only if `input_safety < N` or `secrets_authz < N` (e.g. N = 6); the 3 general scores are informational (shown in the comment, never block) | Tightest signal for a _blocking_ gate; defensible for MVP given the 2 security criteria carry the sub-checks that actually matter for merge safety. |

**Recommendation for the plan**: **A** or **D**, threshold as a composite-action input
(`fail-below`), because that family is the only one obviously correct under "1 = worst" and
explainable in one sentence in the PR comment. With only 5 criteria, **A** (any-criterion floor)
is now simple enough that the group-weighted option isn't worth its knobs. Whatever is chosen:
(a) it is an action input, (b) it is printed verbatim in the comment, (c) it drives the label +
exit outcome, and (d) it is computed in a small unit-tested module (`src/decide.ts`), **not** in
bash/YAML.

### G. Inputs — PR title, description, git diff

Today only `--context <text>` (free text) + file positionals exist. `requirements.md:6-10` wants
title + description + diff as first-class inputs. Options:

| Option                        | Mechanism                                                                                                                                                                                       | Assessment                                                                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Everything via `--context` | concat title + body + full diff into one string                                                                                                                                                 | zero code change; but a large diff blows the context window and the agent sees hunks, not whole files.                                        |
| **2. Dedicated flags**        | `--pr-title`, `--pr-description`, `--diff-file <path>`; `ReviewRequest` gains `prTitle` / `prDescription` / `diff`; prompt assembly (`reviewer.ts:133-139`) restructured into labelled sections | **recommended baseline** — clean separation, `--diff-file` avoids arg-length limits.                                                          |
| 3. Diff as an agent tool      | `get_diff()` / `changed_files()` alongside `list_files` / `read_file`                                                                                                                           | best token economy on big PRs — the agent pulls hunks on demand and reads full post-change files from the checkout; adds a tool + round-trip. |

**Recommended combination**: flags for title/description (always small); the diff as **both** — a
`--diff-file` the reviewer reads to derive _the authoritative changed-files list_ ("these are the
files this PR changed: …" in the prompt), **and** a `changed_files` / `get_diff` tool so the agent
can request specific hunks without the whole diff in the prompt. Cap the inline diff (e.g. inline
only when `< ~2000` lines; above that, tool-only). Criterion `pr_clarity` needs the title/description
in the prompt regardless.

**The file tools stay valuable with a full checkout.** `list_files` / `read_file` are how the agent
reads neighbours the diff doesn't show — sibling test files (`tested`),
`supabase/migrations/**` + RLS policy files (`secrets_authz`), route handlers and their zod
schemas / `src/lib/services/**` (`input_safety`). Required tool
changes: point `--root` at `$GITHUB_WORKSPACE`; tell the agent which files changed (from the diff)
so it doesn't `list_files` the whole repo; **fix the `listFiles` recursion bug** (§A); extend
`IGNORED` (`.astro`, `.wrangler`, `test-results`, `playwright-report`); add `read_file`
offset/limit; optionally `fs.realpath` in `resolveInside`.

### H. Output — PR comment, labels, exit model

The workflow needs two artifacts: machine-readable JSON (pass/fail + label decision) and a Markdown
comment body. Recommended CLI contract:

- Replace `--json` with `--format terminal|json|github`, plus `--json-out <path>` and
  `--markdown-out <path>` so later action steps read files, not stdout.
- New `formatReviewMarkdown(review, decision, usage)` in `format.ts`: a PASS/FAIL header with the
  rule + threshold, a scores table (criterion | group | score | one-line rationale), a `<details>`
  block per criterion with its notes and `file:line` links, and a footer with model + aggregate
  cost from `getUsage()`.
- Compute the aggregate decision **in the reviewer/CLI** (unit-testable) and emit it in the JSON.

**Exit-code model** — today `exit 1` conflates "changes requested" with "the tool crashed". For a
label-driving gate, an OpenRouter outage must not silently label every PR `ai-cr:failed`. Two clean
options:

1. `0` = pass, `1` = fail (review completed), `2` = bad usage, **`3` = infra error**
   (`ReviewParseError`, SDK 4xx/5xx, timeout). The action treats `3` as neutral / retry.
2. **Always exit `0`** and put `decision: "pass" | "fail" | "error"` in the JSON; the action's step
   decides the job outcome and which label to set. **Recommended for a composite action** — no
   bash exit-code plumbing.

### I. Secrets and configuration

- **New repo secret required**: `OPENROUTER_API_KEY` (the app's env var of the same name is unset
  in CI today — the e2e job uses a mock). Add via repo settings; reference as
  `secrets.OPENROUTER_API_KEY`, passed to the composite action as an input, set as `env:` **only**
  on the CLI step.
- Optional config env: `CODE_REVIEWER_MODEL` (already supported, `reviewer.ts:38`), plus new
  `CODE_REVIEWER_FAIL_BELOW` / `CODE_REVIEWER_RULE` if the decision rule is env-configurable.
- **Housekeeping flag**: `.dev.vars` and `.env` on disk (both gitignored) contain real-looking
  plaintext OpenRouter keys, and `packages/code-reviewer/.env` exists locally (gitignored via the
  package `.gitignore`). None are committed. The plan should confirm no key leaks into a CI log or
  artifact (the CLI echoes a progress line to stderr but not the key; `getUsage` / error paths
  should be checked).
- `wrangler.jsonc` has no secret bindings — runtime secrets are `wrangler secret put`; irrelevant
  to this CI-only change.

### J. Relationship to the test-plan and roadmap

- **Not a roadmap slice.** `context/foundation/roadmap.md` slices S-01…S-08 are all product
  features and all `done`; `ai-code-review` is tooling/infra with its own standalone change folder.
- **Not currently a test-plan quality gate.** `context/foundation/test-plan.md` §5 (`:171-181`)
  lists lint / pre-commit / typecheck / unit+integration / e2e-smoke as the required gates; §3
  Phase 4 (`testing-quality-gates-e2e-smoke`, complete) wired them. An AI review label is a **new,
  advisory-flavoured gate** not in that table. After this ships, a `/10x-test-plan --refresh` is a
  reasonable follow-up to record it in §5 (and possibly §7 negative-space: "we don't block merges
  on the AI score" if that's the call) — refresh, not in-scope here.
- **Lessons that apply** (`context/foundation/lessons.md`): use `npx tsc --noEmit` (not
  `npm run typecheck`) if the action shells out to type-check; use `z.treeifyError` (not
  `.flatten()`) for any new Zod error formatting.

### K. Historical context — how CI gates were wired before

- **`context/archive/2026-09-03-testing-llm-and-ownership/`** — Phase 6 "CI gate + cookbook
  finalisation" (`plan.md:783-866`): added a single `- run: npm test` step between `lint` and
  `build`, "so a fast unit failure short-circuits". Contract note: **"No new secrets — the suite is
  hermetic."** The gate went live **with** the suites it gates. Landed as `1cf10d7`. Its
  impl-review's findings were all **scope-creep** cleanup (dead Husky artifacts after the Lefthook
  migration, a coverage regression in `lefthook.yml`'s globs), not GitHub Actions — a caution that
  side-changes ride along on infra work.
- **`context/archive/2026-09-05-testing-quality-gates-e2e-smoke/`** — §3 Phase 4 of the test-plan
  rollout, 5 independently-mergeable phases, riskiest external dependency first:
  - Phase 1 (`plan.md:178-207`): `npx tsc --noEmit` added after `astro sync` — **"No new `env:`
    needed — this step touches no secrets."**
  - Phase 5 (`plan.md:474-533`): the whole `e2e` job. Its plan put `E2E_SUPABASE_*` at **job-level
    `env:`**; **impl-review F4** (`reviews/impl-review.md:66-74`) flagged that this exposes the
    service-role key to `npm ci` / `playwright install` (third-party scripts) → **fixed** by moving
    every secret to a **step-level `env:` on the `playwright test` step**. This produced the
    `ci.yml:49-56` comment and is the pattern to copy.
  - **Plan-review F7** (`reviews/plan-review.md:165-175`): "Required check cannot get secrets on
    fork PRs" — **dismissed, solo project.** Same reasoning lets this change use `pull_request`
    (not `pull_request_target`) and treat fork PRs as unsupported.
  - Plan-review F4 / impl-review F2: app code imports `astro:env/server` (unresolvable outside
    Astro) and the repo's `prefer-nullish-coalescing` lint rule **overrode a plan contract** — the
    lint gate wins.

## Code References

- `packages/code-reviewer/src/schemas.ts:14-76` — current review contract (severity/category/finding/verdict/review); `:3-12` the `.nullable()`-not-`.optional()` strict-output rule
- `packages/code-reviewer/src/reviewer.ts:37-38` — `DEFAULT_MODEL` = `anthropic/claude-sonnet-4.5`
- `packages/code-reviewer/src/reviewer.ts:40-53` — `INSTRUCTIONS` (written for findings/verdict; rewritten by the redesign)
- `packages/code-reviewer/src/reviewer.ts:55-66` — `toJsonSchemaFormat` (strips `$schema`; carries over)
- `packages/code-reviewer/src/reviewer.ts:99-113` — `extractJson` fence/brace recovery
- `packages/code-reviewer/src/reviewer.ts:126-151` — `review()`: prompt assembly + `callModel` request (only `getText()` consumed; `stopWhen: stepCountIs(12)`)
- `packages/code-reviewer/src/tools.ts:17-23` — `resolveInside` lexical path-escape guard (no `realpath`)
- `packages/code-reviewer/src/tools.ts:25` — `IGNORED` regex (applied to `listFiles` only)
- `packages/code-reviewer/src/tools.ts:30-43` — `listFiles` recursion walks `node_modules` before filtering (bug)
- `packages/code-reviewer/src/cli.ts:38-48` — CLI flags; `:93`/`:98-109` exit codes (1 = request_changes _or_ error)
- `packages/code-reviewer/src/format.ts:1-73` — terminal renderer, tied to the old schema
- `packages/code-reviewer/test/reviewer.test.ts:44-51` — `fakeClient` seam; `:16-42` `cannedReview` (old shape); `:170-190` opt-in integration test
- `packages/code-reviewer/package.json:33-43` — deps (`@openrouter/agent ^0.11.0`, `zod ^4.5.4`), devDeps (`typescript ^7.0.2`, `vitest ^5.0.0`)
- `packages/code-reviewer/tsconfig.json` / `tsconfig.build.json` — `nodenext`, `noEmit`; build → `dist/` (gitignored)
- `.github/workflows/ci.yml:3-7` — triggers (`master` only, no `labeled`, no `concurrency`)
- `.github/workflows/ci.yml:10-26` — `ci` job: `tsc --noEmit` → `lint` → `test` → `build`
- `.github/workflows/ci.yml:49-56` — step-scoped-secrets least-privilege comment (origin: quality-gates impl-review F4)
- `.github/workflows/ci.yml:60-62` — `OPENROUTER_API_KEY: e2e-mock-unused` (no real OpenRouter secret in CI)
- `tsconfig.json:3` — root `include: ["**/*"]`, `exclude: ["dist"]` — pulls `packages/**` into root `tsc`
- `eslint.config.js:12,88` — ignores derived only from `.gitignore`; `packages/` not excluded
- `vitest.config.ts:41` — root vitest `include: ["src/**/*.{test,spec}.ts"]` — `packages/**` not run
- `lefthook.yml` — pre-commit `lint` / `typecheck` / `test` also see `packages/**`
- `src/lib/services/llm.ts:1,8-9,15` — app's OpenRouter integration: env var `OPENROUTER_API_KEY`, models `google/gemini-3.5-flash` (vision) / `google/gemini-2.5-flash` (text), plain `fetch`, no SDK, no retry
- `astro.config.mjs:17-27` — env schema; `OPENROUTER_API_KEY` server secret, required
- `context/foundation/test-plan.md:171-181` — §5 quality-gates table (AI review not listed)
- `context/foundation/lessons.md:5-9,12-17` — `npx tsc --noEmit`; `z.treeifyError`
- `context/archive/2026-09-05-testing-quality-gates-e2e-smoke/reviews/impl-review.md:66-74` — F4 (step-scoped secrets)
- `context/archive/2026-09-05-testing-quality-gates-e2e-smoke/reviews/plan-review.md:165-175` — F7 (fork-PR secrets dismissed)
- `context/archive/2026-09-03-testing-llm-and-ownership/plan.md:783-866` — Phase 6 CI-gate wiring pattern

## Architecture Insights

- **The package is a separate deliverable that currently leaks into root tooling.** Root `tsc` and
  `eslint` both see `packages/**`; root `vitest` does not. The plan must pick: formally isolate
  (`exclude` + `ignores` + own CI job) or adopt workspaces. Isolation matches the reality that the
  package pins its own (newer) TS 7 / vitest 5 and has its own prettier width.
- **Strict structured output is best-effort on OpenRouter, provider-dependent.** The whole
  `extractJson` / `ReviewParseError` apparatus exists because of this. The fixed-5-keys object
  (over an array) is the schema choice that stays robust under weak strict enforcement. Add
  `provider: { require_parameters: true }`.
- **An agentic reviewer in CI needs hard cost/time bounds.** `stepCountIs` alone doesn't bound
  cost, and the SDK's default 5XX backoff runs for ~1 hour. Add `maxCost` + a `signal` deadline;
  capture `getUsage()` for the comment footer and job summary.
- **Distinguish "verdict = fail" from "could not run."** The cleanest contract for a composite
  action is: CLI always exits 0, writes `decision: pass | fail | error` + the review + usage to a
  JSON file; the action sets the label and job status from that file.
- **Follow the repo's established CI hygiene**: thin workflow + composite action; secret on exactly
  one step; per-PR `concurrency`; updating (marker-based) PR comment, not a new comment per run;
  create the labels the workflow depends on.
- **The app's own OpenRouter usage is a different pattern** (raw `fetch`, Gemini models, no SDK) —
  the reviewer package deliberately does not share code with `src/lib/services/llm.ts`, and
  shouldn't; they have different needs (agentic tool loop vs single structured call).

## Historical Context (from prior changes)

- `context/archive/2026-09-03-testing-llm-and-ownership/plan.md:783-866` + `reviews/` — the "add
  one CI step, hermetic, no new secrets, gate ships with what it gates" pattern; impl-review caught
  ride-along scope creep.
- `context/archive/2026-09-05-testing-quality-gates-e2e-smoke/plan.md` + `reviews/` — 5-phase
  independently-mergeable CI rollout; **F4** (job-level → step-level secrets) and **F7** (fork-PR
  secrets dismissed as solo project) are the two findings that most directly shape this change.
- `context/foundation/test-plan.md:88-116` — §3 rollout phases; Phase 4 (quality-gates) is the
  closest precedent for "wire a gate into CI".

## Related Research

- No prior `research.md` for `ai-code-review` (this is the first).
- `context/architect-report.md` (untracked, Polish, "Moduł 4") — unrelated to CI wiring; contains a
  BikeFit DDD/stack summary only.
- Adjacent: `context/changes/test-plan-refresh-2026-09-06/` (open) — a separate test-plan refresh,
  not this change.

## Open Questions

These are unspecified in `requirements.md` and are decisions for `/10x-plan`:

1. **Aggregate pass/fail rule + threshold** (§F). Recommend a configurable hard floor
   (`fail-below`, default ~5) or a security-only hard floor. Must be printed in the PR comment.
2. **Can the 3 general criteria (`pr_clarity`, `minimal_readable`, `tested`) block a merge, or only
   the 2 security ones (`input_safety`, `secrets_authz`)?** A security-only blocking gate with the
   3 general scores advisory (shown, never block) is defensible for MVP.
3. **How does the diff enter — prompt, tool, or both?** (§G). Recommend both, with a size cutoff.
4. **CLI exit-code model** (§H): distinct exit codes vs "always 0 + `decision` in JSON". Recommend
   the latter for a composite action.
5. **Review model**: keep `anthropic/claude-sonnet-4.5`, or move to a model with first-class strict
   structured-output support? Either way set `provider: { require_parameters: true }`.
6. **Package isolation from root tooling** (§B): `exclude` + `ignores` + own CI job, vs npm
   workspaces. And: keep the package on TS 7 / vitest 5, or align with the monorepo root
   (TS 5.9 / vitest 4)?
7. **Un-break `master` now or as part of this change's first phase?** A ~5-line commit adding
   `packages/` to root `tsconfig` `exclude` + eslint `ignores` would go green immediately.
8. **Label lifecycle**: pre-create `ai-cr:{passed,failed,review}` once, or create-if-missing in the
   action? Remove `ai-cr:review` after a retry run (recommended)?
9. **Comment style**: one updating comment (marker-based, recommended) vs a fresh comment per run.
10. **Should the AI-review job be a _required_ status check**, or advisory (label only, never blocks
    merge)? This determines whether a `/10x-test-plan --refresh` records it in §5 as required.
