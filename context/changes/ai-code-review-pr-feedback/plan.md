# AI Code-Review — PR Comment, Verdict Labels, On-Demand Retry — Implementation Plan

## Overview

The `ai-code-review` change shipped the review engine, the repo's first composite action, and a
blocking `pull_request` workflow — but **parked** everything PR-facing: the comment, the
`ai-cr:passed` / `ai-cr:failed` labels, and the `ai-cr:review` on-demand retry. This change
unparks all three.

On every completed review the composite action posts a **fresh PR comment** carrying the full
rendered review (the same Markdown that already goes to the run summary), and swaps the verdict
label (`ai-cr:passed` ⇄ `ai-cr:failed`). When the review can't run (OpenRouter outage, missing
key, hard parse failure) it posts a short "could not run" comment and leaves the verdict labels
untouched — mirroring the gate's existing fail-open-on-infra behaviour. Adding the `ai-cr:review`
label re-runs the review; the label is removed automatically at the end of every run so it can be
re-added.

All side-effect logic lives in the existing composite action (keeping the workflow thin, per
`requirements.md`); the workflow gains `pull-requests: write` and a `labeled` trigger. The three
`ai-cr:*` labels are **assumed to already exist as repo labels** — nothing in the workflow or
action creates them (the repo README documents the one-time `gh label create`).

## Current State Analysis

- **`ai-code-review` is complete and closed** (`context/changes/ai-code-review/`, `change.md`
  status `implemented`, plan 100% `[x]`, epilogue `ce7515d`). Its plan's "What We're NOT Doing"
  explicitly defers PR comment + labels + retry to "a follow-up change" — this one.
- **`.github/workflows/ai-code-review.yml`** — triggers `pull_request` `[opened, synchronize,
reopened]` → `master`; `permissions: contents: read`; `concurrency: ai-cr-<pr-number>` with
  `cancel-in-progress: true`. A `diff` step byte-caps the diff (`BUDGET=300000`, `LC_ALL=C`,
  heredoc into `$GITHUB_OUTPUT`) and passes `pr-title` / `pr-description` / `diff` to the action.
- **`.github/actions/ai-code-review/action.yml`** (composite) — `setup-node@v5` → `npm ci` →
  `npm run build` → `npm test` → **Run review** (`id: review`: `--format markdown
--out $RUNNER_TEMP/review.json`, `| tee -a "$GITHUB_STEP_SUMMARY"`, `echo "code=${PIPESTATUS[0]}"
  > > "$GITHUB_OUTPUT"`, step itself exits 0) → **Dump review.json** (`cat`) → **Gate on review
outcome** (reads `steps.review.outputs.code`: `0`pass,`1`→`::error::`+`exit 1`blocks,`2|3`→`::error::`+ pass = fail-open).`OPENROUTER_API_KEY`is`env:` on the review step only.
- **`packages/code-reviewer/` CLI** — writes the rendered Markdown to **stdout** on
  `decision: pass|fail` (before returning exit `0`/`1`); on exit `2`/`3` it writes only the error
  to **stderr** and, if `--out` is set, `{ decision: "error", error, model }` to the JSON file.
  `review.json` on success holds `{ decision, failBelow, minScore, failing, summary, assessment,
criteria, usage, model }`.
- **No package/CLI change is needed** — the review step can `tee` its stdout to a file; the
  comment body is that file (pass/fail) or a line built from `review.json` (`decision: "error"`).
- **The `ai-cr:*` labels do not exist yet** in `mjedrasz/bikefit` (only the 9 GitHub defaults) —
  the operator creates them once; this plan assumes they exist at runtime.
- **Not a roadmap slice** (`context/foundation/roadmap.md` has no `ai-code-review*` Change ID) —
  no roadmap sync.

### Key Discoveries

- **`pull-requests: write` is sufficient** for both `gh pr comment` and `gh pr edit --add-label`
  on a PR — GitHub maps PR comments + labels to the `pull-requests` scope
  (`docs.github.com/actions` — "applying labels to pull requests" is listed under
  `pull-requests: write`; its own triage example does `gh pr edit --add-label` + `gh pr comment`
  with just that). **No `issues: write` needed.**
- **`gh pr edit --add-label X --remove-label Y`** resolves label names against the **repo's**
  label list, not the PR's current labels, and the underlying GraphQL label-removal is
  idempotent. Because the `ai-cr:*` labels are assumed to exist repo-wide, `--remove-label` on a
  label that isn't currently applied is a **harmless no-op** — no `|| true` guard required for
  that case (but see the API-blip guard below).
- **`gh` authenticates in Actions via `GH_TOKEN`** env; `GH_REPO` pins the repo so `gh pr
comment "$PR_NUMBER"` resolves without relying on the checkout's git remote.
- **Setting a label with `GITHUB_TOKEN` does not start a new workflow run** (research §D — events
  raised by the default token don't recurse). So the action adding `ai-cr:passed` won't re-fire
  the `labeled` trigger. The job-level `if` guard catches it anyway.
- **`github.event.pull_request` is populated on `labeled` events** (it's a `pull_request`
  event), so the fork guard, `concurrency` group, and `pr-number` input all keep working under
  the retry trigger.
- **Composite-action steps support `if:` and `${{ always() }}`** (GA since 2022) and can read
  `steps.<id>.outputs` from earlier composite steps. They do **not** reliably support
  `continue-on-error:` — so best-effort is done in bash (`gh … || echo "::warning::…"`), not via
  that key.
- **Lessons** (`context/foundation/lessons.md`): `npx tsc --noEmit` over `npm run typecheck`;
  `z.treeifyError` over `.flatten()`. Neither bites here — this change touches no TypeScript and
  no Zod.

## Desired End State

- Opening or pushing to a PR against `master` runs the **AI code review** workflow, which — in
  addition to the job log + run summary it already produces — **posts a PR comment** containing
  the full rendered review (PASS/FAIL header, one-line summary, assessment paragraph, 5-row score
  table, per-criterion `<details>` notes, model + cost footer), and **sets exactly one verdict
  label**: `ai-cr:passed` when every criterion ≥ `fail-below`, `ai-cr:failed` otherwise, removing
  the other.
- A new comment is posted on **every completed review** (pass or fail, every push) — this is a
  deliberate choice (fresh comment per run, no marker-based editing).
- When the review **can't run** (`decision: "error"`): a short "⚠️ AI code review could not run:
  `<error>`" comment is posted, **neither verdict label is changed**, and the job still passes
  (unchanged fail-open behaviour).
- Adding the **`ai-cr:review`** label to an open PR re-runs the review; the label is removed
  automatically at the end of the run (pass, fail, or error) so it can be re-added to trigger
  again. A retry cancels any in-flight run for that PR (existing `concurrency`).
- Comment + label side-effects **never fail the review job or block a PR** on their own — a
  GitHub API blip degrades to a `::warning::` annotation; the existing gate step remains the sole
  authority on job outcome.
- Fork PRs get no comment and no label change (the side-effect steps are guarded off) — forks
  were already declared unsupported.
- Verification: a clean PR → green comment + `ai-cr:passed`; an unsafe-diff PR → FAIL comment +
  `ai-cr:failed` + job fails; add `ai-cr:review` → re-runs and self-clears the label; unset the
  secret → "could not run" comment, labels unchanged, job green.

## What We're NOT Doing

- **Not creating the `ai-cr:*` labels in YAML.** The workflow/action assume the three labels
  already exist as repo labels. The one-time `gh label create` is documented in the repo README
  only (per the user's instruction).
- **Not using a marker-based / updating comment.** Deliberately a fresh `gh pr comment` per run.
  No `<!-- ai-code-review -->` marker, no `github-script`, no comment de-duplication or deletion.
- **No CLI / `packages/code-reviewer/` changes.** No new flags, no renderer changes, no new
  tests. The review step just `tee`s its existing stdout to a file.
- **No change to the gate semantics.** Blocking on `decision: fail`, fail-open on infra, and the
  `::error::` annotations are all unchanged. This change only adds PR-facing side-effects.
- **No branch-protection / required-check changes.** Making `review` a required check stays a
  documented manual step (deferred in the prior change).
- **No `pull_request_target`.** Still `pull_request`; forks stay unsupported.
- **No `context/foundation/test-plan.md` §5 / §6 edits.** Recording the AI review as a gate is a
  later `/10x-test-plan --refresh`.
- **No condensed / second comment renderer.** The comment reuses the full Markdown verbatim
  (byte-truncated only as an overflow safety net).
- **No "now passing" follow-up note or comment cleanup on green.** Every run just posts the
  current review.

## Implementation Approach

Two phases, each independently mergeable, each touching only `.github/` + the repo `README.md`:

1. **PR comment + verdict labels** — the workflow gains `pull-requests: write` and passes a new
   `pr-number` input; the action `tee`s the rendered review to a file and gains three steps
   (build comment body, post comment, set verdict label) inserted **before** the existing gate
   step, all best-effort and fork-guarded. README documents the behaviour + the one-time label
   creation.
2. **On-demand retry via `ai-cr:review`** — the workflow adds the `labeled` trigger type and a
   job-level `if` guard; the action gains one `if: always()` fork-guarded step that removes
   `ai-cr:review` at the end of every run. README documents the retry.

This mirrors the repo's established CI-rollout pattern (research §K on the parent change): small
independently-mergeable phases, no ride-along scope creep, side-effects that can't wedge the
gate.

## Critical Implementation Details

- **Step ordering.** The three new side-effect steps (Phase 1) and the retry-label cleanup
  (Phase 2) must sit **after** "Dump review.json" and **before** the existing "Gate on review
  outcome" step — the gate does `exit 1` on a failing review, which would otherwise skip anything
  after it. The gate stays the last step.
- **Side-effects are best-effort in bash, not `continue-on-error`.** Every `gh` invocation in the
  new steps is `gh … || echo "::warning::<what failed>"` so a transient GitHub API error surfaces
  as a warning annotation and the step still exits 0 — a comment/label hiccup must never fail the
  review job or block a PR. Composite-action steps don't reliably honour `continue-on-error:`.
- **Capturing the rendered review.** The review step's pipeline becomes
  `node … | tee "$RUNNER_TEMP/review.md" | tee -a "$GITHUB_STEP_SUMMARY"`; `${PIPESTATUS[0]}`
  still indexes the `node` process (first in the pipe), so `code=` is unchanged. On
  `decision: "error"` the CLI writes nothing to stdout, so `review.md` is empty and the
  comment-body step falls back to `review.json`'s `.error`.
- **Comment body size.** GitHub caps a comment at 65536 chars. `review.md` excludes the diff and
  is normally well under, but per-criterion notes are model-controlled — truncate `review.md` to
  60000 **bytes** under `LC_ALL=C` (consistent with the diff step) and append a
  "…truncated — see the run summary" line + run URL when it overflows.
- **Fork guard.** All three Phase-1 side-effect steps and the Phase-2 cleanup step carry
  `if: ${{ github.event.pull_request.head.repo.full_name == github.repository }}` (plus
  `always() &&` on the cleanup) — a fork PR's read-only `GITHUB_TOKEN` can't comment or label,
  and forks are unsupported.
- **Permissions.** Add only `pull-requests: write` to the workflow `permissions:` block
  (alongside the existing `contents: read`). Not `issues: write`, not `contents: write`.
- **Retry `if` guard.** Job-level
  `if: github.event.action != 'labeled' || github.event.label.name == 'ai-cr:review'` — runs for
  `opened`/`synchronize`/`reopened` unconditionally, and for `labeled` only when the added label
  is `ai-cr:review`.
- **Never leak the key.** `OPENROUTER_API_KEY` stays `env:` on the review step only. Confirm the
  new steps (which read `review.json` / `review.md` / `steps.review.outputs.code`, none of which
  contain the key) don't echo it, and that `gh` output doesn't either.

---

## Phase 1: PR comment + verdict labels

### Overview

Post the rendered review as a fresh PR comment on every completed run, and set one of
`ai-cr:passed` / `ai-cr:failed` to match the decision. On `decision: "error"`, post a short
"could not run" comment and leave the verdict labels alone. All new work is in the workflow
(`permissions`, one new input) and the composite action (one pipe tweak + three new steps).

### Changes Required:

#### 1. Workflow — permissions + `pr-number` input

**File**: `.github/workflows/ai-code-review.yml`

**Intent**: Grant the token the write scope the comment/label steps need, and hand the action
the PR number so it can address `gh pr comment` / `gh pr edit`.

**Contract**:

- `permissions:` block gains `pull-requests: write` (keep `contents: read`).
- The `uses: ./.github/actions/ai-code-review` step's `with:` gains
  `pr-number: ${{ github.event.pull_request.number }}`.
- Nothing else in this phase — trigger types and `concurrency` are unchanged.

#### 2. Composite action — new `pr-number` input

**File**: `.github/actions/ai-code-review/action.yml`

**Intent**: Declare the input the new steps consume.

**Contract**: Add to `inputs:` — `pr-number` (`description`, `required: true`). No default.

#### 3. Composite action — capture the rendered review to a file

**File**: `.github/actions/ai-code-review/action.yml` (the "Run review" step)

**Intent**: Make the Markdown the CLI already prints available as a file for the comment step.

**Contract**: Change the review step's pipeline to
`node packages/code-reviewer/dist/cli.js … | tee "$RUNNER_TEMP/review.md" | tee -a "$GITHUB_STEP_SUMMARY"`.
`rc=${PIPESTATUS[0]}` and `echo "code=${rc}" >> "$GITHUB_OUTPUT"` are unchanged (the `node`
process is still pipe element 0).

#### 4. Composite action — build the comment body

**File**: `.github/actions/ai-code-review/action.yml` (new step, after "Dump review.json")

**Intent**: Produce `$RUNNER_TEMP/comment.md` — the full rendered review on pass/fail, a short
"could not run" block on error — and expose the decision to the later steps.

**Contract**: New step `name: Build PR comment body`, `id: comment`, `shell: bash`, `env:` with
`RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}`.
Logic:

- `DECISION="$(jq -r '.decision // "error"' "$RUNNER_TEMP/review.json" 2>/dev/null || echo error)"`.
- If `DECISION == "error"`: write a header line (`🤖 AI code review · [run]($RUN_URL)`), then
  `### ⚠️ AI code review could not run`, the `jq -r '.error'` value in backticks, and a
  "_Not blocking the PR (fail-open on infra); verdict labels left unchanged._" line.
- Else: write the header line, then the contents of `$RUNNER_TEMP/review.md`; if `review.md`
  exceeds 60000 bytes (`LC_ALL=C`, `wc -c`), emit `head -c 60000` + a
  "_…truncated — full review in the [run summary]($RUN_URL)._" line.
- `echo "decision=${DECISION}" >> "$GITHUB_OUTPUT"`.

`jq` is preinstalled on `ubuntu-latest`.

#### 5. Composite action — post the PR comment

**File**: `.github/actions/ai-code-review/action.yml` (new step, after step 4)

**Intent**: Post `comment.md` as a fresh comment on the PR.

**Contract**: New step `name: Post PR comment`,
`if: ${{ github.event.pull_request.head.repo.full_name == github.repository }}`, `shell: bash`,
`env:` `GH_TOKEN: ${{ github.token }}`, `GH_REPO: ${{ github.repository }}`,
`PR_NUMBER: ${{ inputs.pr-number }}`. Body:
`gh pr comment "$PR_NUMBER" --body-file "$RUNNER_TEMP/comment.md" || echo "::warning::failed to post the AI code review PR comment"`.

#### 6. Composite action — set the verdict label

**File**: `.github/actions/ai-code-review/action.yml` (new step, after step 5)

**Intent**: Add the matching verdict label and remove the other; do nothing on error.

**Contract**: New step `name: Set verdict label`,
`if: ${{ github.event.pull_request.head.repo.full_name == github.repository }}`, `shell: bash`,
`env:` `GH_TOKEN`, `GH_REPO`, `PR_NUMBER` (as step 5) plus
`DECISION: ${{ steps.comment.outputs.decision }}`. Body — `set -euo pipefail`, then:

```bash
case "$DECISION" in
  pass) gh pr edit "$PR_NUMBER" --add-label "ai-cr:passed" --remove-label "ai-cr:failed" \
          || echo "::warning::failed to set ai-cr:passed" ;;
  fail) gh pr edit "$PR_NUMBER" --add-label "ai-cr:failed" --remove-label "ai-cr:passed" \
          || echo "::warning::failed to set ai-cr:failed" ;;
  *)    echo "decision=$DECISION — leaving verdict labels unchanged" ;;
esac
```

#### 7. Repo README — document comment + labels + one-time label creation

**File**: `README.md` (the "## AI code review" section, ~L234–272)

**Intent**: Replace the "planned follow-up" note with the real behaviour, and add label creation
to the one-time setup.

**Contract**:

- In the one-time setup block (next to `gh secret set OPENROUTER_API_KEY`), add:
  `gh label create "ai-cr:passed" --color 0E8A16 --force`,
  `gh label create "ai-cr:failed" --color D73A4A --force`,
  `gh label create "ai-cr:review" --color FBCA04 --force` with a one-line note that the workflow
  assumes these exist.
- Under "Gate behaviour", add bullets: a fresh PR comment with the full rendered review is posted
  on every completed run; `ai-cr:passed` / `ai-cr:failed` track the latest verdict; on an infra
  error the comment says "could not run" and the labels are left unchanged; comment/label
  failures degrade to warnings and never block.
- Replace the trailing "PR comments, labels, and on-demand retry are a planned follow-up." with a
  line noting on-demand retry is covered in Phase 2 (or just drop "retry" here and let Phase 2
  edit it).

### Success Criteria:

#### Automated Verification:

- Workflow validates: `npx --yes @action-validator/cli .github/workflows/ai-code-review.yml` exits 0
- Action YAML parses: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/actions/ai-code-review/action.yml'))"`
- `actionlint .github/workflows/ai-code-review.yml` clean (shellcheck vets the new bash), if `actionlint` is available
- Workflow `permissions:` contains `pull-requests: write`: `grep -q 'pull-requests: write' .github/workflows/ai-code-review.yml`
- Action wires both verdict labels: `grep -q 'ai-cr:passed' .github/actions/ai-code-review/action.yml && grep -q 'ai-cr:failed' .github/actions/ai-code-review/action.yml`
- The new side-effect steps precede the gate step: `awk '/Set verdict label/{l=NR} /Gate on review outcome/{g=NR} END{exit !(l && g && l<g)}' .github/actions/ai-code-review/action.yml`
- Root CI still green: `npm run lint && npx tsc --noEmit && npm test` (packages/ still excluded — unchanged)

#### Manual Verification:

- Open a clean PR to `master`: the workflow runs; a PR comment appears with the full rendered
  review (PASS header, 5-row score table, footer); `ai-cr:passed` is on the PR, `ai-cr:failed` is
  not; the job is green.
- Open a PR whose diff adds an unvalidated request body / hardcoded token: the comment shows a
  FAIL header and low security scores; `ai-cr:failed` is on the PR, `ai-cr:passed` is not; the
  job fails.
- Push a fixing commit to that PR: a **new** comment is posted; the labels swap to `ai-cr:passed`.
- Temporarily unset `OPENROUTER_API_KEY` (or pass a bad `--model`): the comment reads
  "⚠️ AI code review could not run: …"; neither verdict label changes; the job passes.
- The rendered comment displays correctly on GitHub — table renders, `<details>` blocks collapse.
- No `OPENROUTER_API_KEY` value appears in the comment, the job log, or the run summary.
- If a fork PR is available: the review runs, and the Post-comment / Set-label steps are skipped
  (fork guard) without failing the job.

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before
proceeding to Phase 2.

---

## Phase 2: On-demand retry via `ai-cr:review`

### Overview

Let a maintainer re-run the review by adding the `ai-cr:review` label, and remove that label
automatically at the end of every run so it stays re-addable. One new trigger type + one
job-level `if` guard in the workflow; one new fork-guarded `if: always()` step in the action.

### Changes Required:

#### 1. Workflow — `labeled` trigger + guard

**File**: `.github/workflows/ai-code-review.yml`

**Intent**: React to `ai-cr:review` being added, and only to that label.

**Contract**:

- `on.pull_request.types` becomes `[opened, synchronize, reopened, labeled]`.
- The `review` job gains
  `if: >-\n  github.event.action != 'labeled' ||\n  github.event.label.name == 'ai-cr:review'`.
- `concurrency` is unchanged — `github.event.pull_request.number` is populated on `labeled`
  events, so a retry still cancels an in-flight run for the same PR.

#### 2. Composite action — remove `ai-cr:review` after the run

**File**: `.github/actions/ai-code-review/action.yml` (new step, after "Set verdict label",
before "Gate on review outcome")

**Intent**: Clear the retry trigger so it can be added again; do it regardless of pass / fail /
error / earlier-step failure.

**Contract**: New step `name: Clear retry label`,
`if: ${{ always() && github.event.pull_request.head.repo.full_name == github.repository }}`,
`shell: bash`, `env:` `GH_TOKEN: ${{ github.token }}`, `GH_REPO: ${{ github.repository }}`,
`PR_NUMBER: ${{ inputs.pr-number }}`. Body:
`gh pr edit "$PR_NUMBER" --remove-label "ai-cr:review" || echo "::warning::failed to clear ai-cr:review"`.
Removing a label that isn't applied is a no-op (label assumed to exist repo-wide), so this is
safe to run on every event, including `opened`/`synchronize`.

#### 3. Repo README — document the retry

**File**: `README.md` (the "## AI code review" section)

**Intent**: Tell maintainers how to force a re-review.

**Contract**: Add a bullet: adding the `ai-cr:review` label to a PR re-runs the review; the label
is removed automatically when the run finishes, so re-adding it triggers another run. Note that a
retry cancels any in-progress run for that PR. Remove the last "planned follow-up" sentence
entirely.

### Success Criteria:

#### Automated Verification:

- Workflow validates: `npx --yes @action-validator/cli .github/workflows/ai-code-review.yml` exits 0
- Action YAML parses: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/actions/ai-code-review/action.yml'))"`
- `actionlint .github/workflows/ai-code-review.yml` clean, if available
- `labeled` is a trigger type: `grep -Eq 'types:.*labeled' .github/workflows/ai-code-review.yml`
- The job `if` guard names `ai-cr:review`: `grep -q "github.event.label.name == 'ai-cr:review'" .github/workflows/ai-code-review.yml`
- The cleanup step precedes the gate step: `awk '/Clear retry label/{l=NR} /Gate on review outcome/{g=NR} END{exit !(l && g && l<g)}' .github/actions/ai-code-review/action.yml`
- Root CI still green: `npm run lint && npx tsc --noEmit && npm test`

#### Manual Verification:

- On an open PR, add the `ai-cr:review` label: the workflow re-runs, posts a fresh comment,
  updates the verdict label, and the `ai-cr:review` label is gone when the run finishes.
- Re-add `ai-cr:review`: it triggers another run (proves the auto-removal keeps it re-addable).
- Add an unrelated label (e.g. a default like `documentation`): the workflow run is created but
  skipped by the `if` guard (no review runs, no comment).
- Confirm the action adding `ai-cr:passed` / `ai-cr:failed` does not itself kick off a new
  workflow run.
- Add `ai-cr:review` while a run is in progress: the stale run is cancelled by the `concurrency`
  group and a fresh run starts.

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation. This is the last phase.

---

## Testing Strategy

### Unit Tests

None. This change touches only `.github/` YAML + embedded bash + `README.md`; there is no
application or package code, and the repo has no test harness for workflow YAML (Phase 3 of the
parent change established `actionlint` + `@action-validator/cli` + a YAML-parse check + manual PR
runs as the verification bar).

### Static Verification

- `npx --yes @action-validator/cli .github/workflows/ai-code-review.yml`
- `python3 -c "import yaml; yaml.safe_load(open('.github/actions/ai-code-review/action.yml'))"`
- `actionlint` (shellcheck vets the embedded comment-body / label / cleanup scripts for quoting
  bugs), if available
- Root `npm run lint && npx tsc --noEmit && npm test` unchanged and green (packages/ still
  excluded from root tooling)

### Manual Testing Steps

1. **Pre-req** — `gh label create` the three `ai-cr:*` labels once on `mjedrasz/bikefit`.
2. **Clean PR** — small safe change → comment with PASS review + `ai-cr:passed`, job green.
3. **Unsafe PR** — unvalidated body / hardcoded token → comment with FAIL review + `ai-cr:failed`,
   job fails.
4. **Fix commit** — push a fix to the unsafe PR → new comment, labels swap to `ai-cr:passed`.
5. **Infra error** — unset the secret or use a bad model slug → "could not run" comment, verdict
   labels unchanged, job green.
6. **Retry** (Phase 2) — add `ai-cr:review` → re-runs, self-clears the label; re-add → triggers
   again.
7. **Guard** (Phase 2) — add an unrelated label → run skipped.
8. **No key leak** — grep the job log / comment / run summary for the key value: absent.

## Performance Considerations

- No extra model calls — the comment/label steps are pure GitHub API calls (a few hundred ms
  each) after the review the job already runs.
- A fresh comment per run means an active PR accumulates comments (one full review each). This is
  the chosen behaviour; `concurrency: cancel-in-progress` keeps a burst of pushes to roughly one
  comment. If noise becomes a problem, switching to a marker-based updating comment is a
  self-contained follow-up (swap the `gh pr comment` call for a list-then-update).

## Migration Notes

- No data migration. Reverting is: drop `pull-requests: write` + the `labeled` type + the job
  `if` from the workflow, drop the `pr-number` input + the four new steps + the `review.md` tee
  from the action, revert the README section. The parent `ai-code-review` pipeline keeps working
  unchanged.
- The `ai-cr:*` labels, once created, are harmless if left after a revert.

## References

- Parent change (complete): `context/changes/ai-code-review/plan.md` ("What We're NOT Doing" —
  PR comment + labels + retry parked), `research.md` §D (PR comment + labels mechanics), §H
  (output / exit model), `requirements.md` ("Expected side-effects", "Expected behavior")
- Current workflow: `.github/workflows/ai-code-review.yml`
- Current composite action: `.github/actions/ai-code-review/action.yml` (review step pipeline,
  `steps.review.outputs.code`, gate step)
- Current CLI output contract: `packages/code-reviewer/src/cli.ts` (stdout Markdown on
  pass/fail; `{ decision: "error", … }` JSON on exit 2/3), `src/format.ts`
  (`formatReviewMarkdown`)
- Repo README section to edit: `README.md` "## AI code review"
- Permission mapping: GitHub Actions docs — PR comments + labels under `pull-requests: write`
- Step-scoped-secrets precedent: `.github/workflows/ci.yml:49-56`
- CI-rollout pattern: `context/archive/2026-09-05-testing-quality-gates-e2e-smoke/`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles. See `references/progress-format.md`.

### Phase 1: PR comment + verdict labels

#### Automated

- [x] 1.1 Workflow validates: `npx --yes @action-validator/cli .github/workflows/ai-code-review.yml` exits 0 — a78b25b
- [x] 1.2 Action YAML parses via `python3 -c "import yaml; yaml.safe_load(...)"` — a78b25b
- [x] 1.3 `actionlint` clean on the workflow + action, if available — a78b25b
- [x] 1.4 Workflow `permissions:` contains `pull-requests: write` — a78b25b
- [x] 1.5 Action wires both `ai-cr:passed` and `ai-cr:failed` — a78b25b
- [x] 1.6 The new side-effect steps precede the "Gate on review outcome" step — a78b25b
- [x] 1.7 Root CI still green: `npm run lint && npx tsc --noEmit && npm test` — a78b25b

#### Manual

- [x] 1.8 Clean PR → comment with PASS review, `ai-cr:passed` set / `ai-cr:failed` absent, job green — a78b25b
- [x] 1.9 Unsafe-diff PR → comment with FAIL review, `ai-cr:failed` set / `ai-cr:passed` absent, job fails — a78b25b
- [x] 1.10 Fix commit on the unsafe PR → new comment posted, labels swap to `ai-cr:passed` — a78b25b
- [x] 1.11 Infra error (unset secret / bad model) → "could not run" comment, verdict labels unchanged, job green — a78b25b
- [x] 1.12 Comment renders correctly on GitHub (table, collapsible `<details>`) — a78b25b
- [x] 1.13 No `OPENROUTER_API_KEY` value in the comment, job log, or run summary — a78b25b
- [x] 1.14 Fork PR (if available) → review runs, comment/label steps skipped by the fork guard, job not failed — a78b25b

### Phase 2: On-demand retry via `ai-cr:review`

#### Automated

- [x] 2.1 Workflow validates: `npx --yes @action-validator/cli .github/workflows/ai-code-review.yml` exits 0
- [x] 2.2 Action YAML parses via `python3 -c "import yaml; yaml.safe_load(...)"`
- [x] 2.3 `actionlint` clean, if available
- [x] 2.4 `labeled` present in `on.pull_request.types`
- [x] 2.5 Job `if` guard references `github.event.label.name == 'ai-cr:review'`
- [x] 2.6 The "Clear retry label" step precedes the "Gate on review outcome" step
- [x] 2.7 Root CI still green: `npm run lint && npx tsc --noEmit && npm test`

#### Manual

- [x] 2.8 Add `ai-cr:review` on an open PR → workflow re-runs, fresh comment, verdict label updated, `ai-cr:review` auto-removed
- [x] 2.9 Re-add `ai-cr:review` → triggers another run
- [x] 2.10 Add an unrelated label → workflow run skipped by the `if` guard
- [x] 2.11 Action-set `ai-cr:passed` / `ai-cr:failed` does not kick off a new workflow run
- [x] 2.12 Add `ai-cr:review` mid-run → stale run cancelled by `concurrency`, fresh run starts
