# AI Code-Review — PR Comment, Verdict Labels, On-Demand Retry — Plan Brief

> Full plan: `context/changes/ai-code-review-pr-feedback/plan.md`
> Upstream: `context/changes/ai-code-review/research.md` §D, §H · `.../requirements.md`

## What & Why

The `ai-code-review` change shipped the review engine, the composite action, and a blocking PR
workflow — but parked everything PR-facing. This change adds the three deferred side-effects: a
**PR comment** carrying the rendered review, the **`ai-cr:passed` / `ai-cr:failed`** verdict
labels, and an **`ai-cr:review`** on-demand retry. Together they make the review's outcome
visible on the PR itself instead of only in the Actions job log / run summary.

## Starting Point

`.github/workflows/ai-code-review.yml` (thin, `contents: read`, per-PR concurrency) computes a
byte-capped diff and hands off to `.github/actions/ai-code-review/action.yml`, which builds +
tests `packages/code-reviewer/`, runs one OpenRouter review, writes the rendered Markdown to the
run summary + a `review.json`, and a gate step fails the job on `decision: fail` (fail-open on
infra). The CLI already prints the exact Markdown a comment wants. The `ai-cr:*` labels don't
exist in the repo yet.

## Desired End State

Every completed review posts a fresh PR comment with the full rendered review (PASS/FAIL header,
score table, per-criterion notes, cost footer) and sets one verdict label, removing the other.
An infra error posts a short "could not run" comment and leaves the labels untouched. Adding
`ai-cr:review` re-runs the review and the label clears itself so it's re-addable. Comment/label
failures degrade to warnings — they never block a PR; the existing gate stays the sole authority.

## Key Decisions Made

| Decision                         | Choice                                                  | Why                                                                                                  | Source |
| -------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------ |
| Where the plan lives             | New change folder `ai-code-review-pr-feedback`          | Parent change is `implemented` and closed with an epilogue; its plan calls this "a follow-up change" | Plan   |
| On-demand retry (`ai-cr:review`) | In scope, this change                                   | Completes `requirements.md` in one pass; ~10 lines; label already assumed to exist                   | Plan   |
| Comment mechanism                | Fresh `gh pr comment` per run                           | Simplest; no marker/`github-script`/de-dup machinery                                                 | Plan   |
| Comment body                     | Full rendered review verbatim (`formatReviewMarkdown`)  | Zero new rendering code; same content as the run summary                                             | Plan   |
| Comment cadence                  | Every completed review (pass and fail)                  | Latest review always visible without opening the run                                                 | Plan   |
| Infra error (`decision: error`)  | Short "could not run" comment, verdict labels untouched | Mirrors the fail-open gate; never applies a misleading label                                         | Plan   |
| Labels exist repo-wide           | Assumed; not created in YAML                            | Per user instruction; README documents the one-time `gh label create`                                | User   |
| Logic location                   | In the composite action, before the gate step           | Keeps the workflow thin (`requirements.md` intent); consistent with the existing gate step           | Plan   |
| Side-effect failures             | Best-effort in bash (`gh … \|\| echo "::warning::"`)    | A GitHub API blip must not fail the review job or block a PR                                         | Plan   |

## Scope

**In scope:**

- Workflow: `pull-requests: write`, `labeled` trigger type, job-level `if` guard, new `pr-number` input pass-through
- Action: `tee` the rendered review to a file; new steps — build comment body, post comment, set verdict label, clear retry label — all fork-guarded, all best-effort, all before the gate step
- Repo `README.md`: document the behaviour + the one-time `gh label create`

**Out of scope:**

- Creating the `ai-cr:*` labels in YAML
- Marker-based / updating / de-duplicated comments; a condensed comment renderer
- Any `packages/code-reviewer/` CLI, renderer, schema, or test change
- Gate-semantics changes; branch-protection / required-check changes
- `pull_request_target` / fork support
- `context/foundation/test-plan.md` edits

## Architecture / Approach

Workflow stays the orchestrator (permissions, triggers, diff, hand-off). The composite action
grows four steps between "Dump review.json" and the existing "Gate on review outcome" step:
`review.json`'s `.decision` drives whether the comment body is the tee'd `review.md` or a
"could not run" line, whether a verdict label is set, and (always) the `ai-cr:review` cleanup.
`gh` authenticates via `GH_TOKEN`/`GH_REPO`; every `gh` call is `|| echo "::warning::…"` so the
gate step remains the only thing that can fail the job. Fork PRs are guarded out.

## Phases at a Glance

| Phase                          | What it delivers                                                                                   | Key risk                                                                                    |
| ------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1. PR comment + verdict labels | Comment on every run + `ai-cr:passed`/`ai-cr:failed` swap; infra-error comment leaves labels alone | Step ordering (must precede the `exit 1` gate); `pull-requests: write` scope sufficiency    |
| 2. On-demand retry             | `ai-cr:review` re-runs the review and self-clears                                                  | `labeled` trigger widening; `if`-guard correctness; composite-step `if: always()` behaviour |

**Prerequisites:** `OPENROUTER_API_KEY` repo secret already set (done in the parent change);
`gh label create` the three `ai-cr:*` labels once before manual verification.
**Estimated effort:** ~1 session, 2 small phases, `.github/` + README only.

## Open Risks & Assumptions

- **Assumes** the `ai-cr:*` labels exist at runtime — the workflow/action don't create them; a
  missing label would surface as a `::warning::` from `gh pr edit`, not a hard failure.
- **Assumes** `pull-requests: write` alone covers `gh pr comment` + `gh pr edit --add-label` on a
  PR (GitHub docs + their own triage example support this); if a run shows a 403 on labels, add
  `issues: write` — a one-line change.
- **Assumes** composite-action steps honour `if:` / `${{ always() }}` (GA since 2022) — verified
  by `actionlint` and the Phase 2 manual retry test.
- Fresh-comment-per-run is noisy on very active PRs by design; switching to a marker-based
  updating comment later is self-contained.

## Success Criteria (Summary)

- A clean PR shows a green review comment + `ai-cr:passed`; an unsafe PR shows a FAIL comment +
  `ai-cr:failed` and the job fails.
- An OpenRouter outage / missing key produces a "could not run" comment, unchanged verdict
  labels, and a green job.
- Adding `ai-cr:review` re-runs the review and the label clears itself; an unrelated label is
  ignored.
- No comment/label error ever fails the review job or blocks a PR; no key value leaks into the
  comment or logs.
