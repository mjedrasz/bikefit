# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Use `npx tsc --noEmit` for TypeScript checks

- **Context**: Any implement phase that runs TypeScript checks
- **Problem**: `npm run typecheck` fails with "command not found" because the script is not defined in package.json, blocking the type-check step.
- **Rule**: Do not use `npm run typecheck`. Use `npx tsc --noEmit` instead.
- **Applies to**: implement, impl-review

## Use z.treeifyError instead of ZodError.flatten

- **Context**: Any API route or service that uses Zod validation
- **Problem**: Using `.flatten()` triggers `@typescript-eslint/no-deprecated` lint errors and TypeScript compiler warnings — it was deprecated in Zod v4 in favour of `z.treeifyError`.
- **Rule**: Always use `z.treeifyError(err)` instead of `ZodError.flatten()` when formatting Zod validation errors. `flatten()` is deprecated as of Zod v4.
- **Applies to**: implement, impl-review
