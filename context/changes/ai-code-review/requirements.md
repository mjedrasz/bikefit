## Overall concept

- GHA workflow run for every new pull request to master
- composite action for the review itself so that main workflow is easy to reason about

## Input parameters

- pull request title
- pull request description
- git diff

## Code Review Criteria

Five criteria. Each is scored on a 1–10 scale, where 1 is the worst outcome and 10 is the best.
The `id` is the stable key used in the review schema and the PR comment.

1. **`pr_clarity` — Clear PR title & description.** Title states the change; description covers
   what, why, and how to test. Linked issue.
2. **`minimal_readable` — Minimal, readable implementation.** Solves the stated problem, no
   speculative abstraction or unrelated changes, diff is as small as it can be. Names say what
   things are; matches surrounding style; no dead code, stray logs, or commented-out blocks.
3. **`tested` — Tested.** New logic has tests; changed behavior updates existing ones. Edge cases
   and error paths covered.
4. **`input_safety` — Input validated at boundaries & no unsafe sinks.** API bodies, params, and
   env vars parsed with zod before use; never cast raw JSON to a type. Parameterized queries only;
   no unsanitized HTML (`set:html`, `dangerouslySetInnerHTML`); no user input in shell or redirects.
5. **`secrets_authz` — Secrets & authorization.** Keys/tokens from env only; nothing sensitive
   logged or committed. Every protected route/query checks the current user; RLS policies present
   on new tables.

## Parked for later

- business alignment (requires broader context)
- architectural fit (requires broader context)
- TypeScript-specific criteria (no `any` / unsafe casts, null handled not asserted, typed public
  surfaces, async is safe) — dropped from v1 to keep the review to 5 criteria. Largely already
  enforced by the existing required CI gates (`npx tsc --noEmit` + `eslint` with
  `strictTypeChecked`). Revisit if type-safety regressions slip through those gates.

## Expected side-effects

- PR comment with summary
- labels: `ai-cr:failed` (red) OR `ai-cr:passed` (green)

## Expected behavior

- on-demand retry when label `ai-cr:review` is added
