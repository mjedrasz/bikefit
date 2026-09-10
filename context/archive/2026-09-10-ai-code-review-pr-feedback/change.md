---
change_id: ai-code-review-pr-feedback
title: AI code review — PR comment, verdict labels, on-demand retry
status: archived
created: 2026-09-10
updated: 2026-09-10
archived_at: 2026-09-10T19:40:46Z
---

## Notes

Follow-up to the completed `ai-code-review` change, which shipped the review engine +
composite action + blocking workflow but **parked** the PR-facing feedback:

- a PR comment carrying the rendered review
- `ai-cr:passed` / `ai-cr:failed` labels tracking the latest verdict
- an on-demand retry when `ai-cr:review` is added

The three `ai-cr:*` labels are assumed to already exist as repo labels — the
workflow/action do not create them (README documents the one-time `gh label create`).

Upstream: `context/changes/ai-code-review/research.md` §D (PR comment + labels mechanics),
§H (output / exit model), `requirements.md` ("Expected side-effects", "Expected behavior").
