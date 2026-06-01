# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Use `npx tsc --noEmit` for TypeScript checks

- **Context**: Any implement phase that runs TypeScript checks
- **Problem**: `npm run typecheck` fails with "command not found" because the script is not defined in package.json, blocking the type-check step.
- **Rule**: Do not use `npm run typecheck`. Use `npx tsc --noEmit` instead.
- **Applies to**: implement, impl-review
