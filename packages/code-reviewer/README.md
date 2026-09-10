# @10x/code-reviewer

Single-call PR code review on [OpenRouter](https://openrouter.ai). Given a PR
title, description, and unified diff, it makes **one** structured model call (no
tools, no repo browsing) and returns a review that scores the change against five
criteria on a 1–10 scale:

| Criterion          | Group    | Checks                                             |
| ------------------ | -------- | -------------------------------------------------- |
| `pr_clarity`       | general  | Title/description say what, why, how to test       |
| `minimal_readable` | general  | Small focused diff, clear names, no dead code      |
| `tested`           | general  | New logic has tests; edge/error paths covered      |
| `input_safety`     | security | Boundary validation, parameterized queries, no XSS |
| `secrets_authz`    | security | Secrets from env only, auth checks, RLS on tables  |

Plus a one-line `summary` and a holistic `assessment` paragraph. A review where
any criterion scores below `--fail-below` (default `5`) exits non-zero — that is
how the CI gate blocks a PR.

## Usage

```
npm run build          # compile src/ -> dist/ (required before running dist/cli.js)

node dist/cli.js --diff "<unified diff text>" [options]
node dist/cli.js --diff-file <path> [options]
```

Exactly one of `--diff` (diff text passed directly — how CI invokes it) or
`--diff-file` (reads a file — local runs, the integration fixture) is required.

| Flag                  | Default                       | Purpose                                    |
| --------------------- | ----------------------------- | ------------------------------------------ |
| `--pr-title`          | `""`                          | PR title (drives `pr_clarity`)             |
| `--pr-description`    | `""`                          | PR description / body                      |
| `--model`             | `anthropic/claude-sonnet-4.5` | OpenRouter model slug                      |
| `--fail-below <n>`    | `5`                           | Fail if any criterion scores `< n` (1..10) |
| `--max-output-tokens` | `8000`                        | Generation ceiling for the single call     |
| `--timeout-ms`        | `300000`                      | Wall-clock deadline for the call           |
| `--format`            | `markdown`                    | `terminal` \| `markdown` \| `json`         |
| `--out <path>`        | —                             | Also write the JSON result to this path    |

`--max-cost` / `--max-tokens` are accepted but inert for this single-call design
(kept for a future tools variant).

### Exit codes

| Code | Meaning                                                              |
| ---- | -------------------------------------------------------------------- |
| `0`  | review completed — `decision: pass`                                  |
| `1`  | review completed — `decision: fail` (a criterion scored below floor) |
| `2`  | bad usage / missing `OPENROUTER_API_KEY`                             |
| `3`  | infra error — parse failure, SDK/network error, timeout, empty diff  |

## Environment

| Variable              | Required | Purpose                                     |
| --------------------- | -------- | ------------------------------------------- |
| `OPENROUTER_API_KEY`  | yes      | OpenRouter key — https://openrouter.ai/keys |
| `CODE_REVIEWER_MODEL` | no       | Overrides the default model slug            |

Copy `.env.example` to `.env` for local runs; the CLI loads it automatically.

## Tests

```
npm test                 # unit suite (fake client, no network)
npm run test:integration # opt-in: one real model call over test/fixtures/insecure-login.diff
```

`test:integration` needs a real `OPENROUTER_API_KEY` and asserts the model gives
the insecure-login diff a low `input_safety` score.
