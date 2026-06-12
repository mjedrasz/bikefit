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

## Prefer TF.js CPU backend over MediaPipe when WebGL2 is not guaranteed

- **Context**: Any phase introducing browser-side ML/vision inference (pose estimation, image classification, etc.) in a React island or client-side component
- **Problem**: MediaPipe Tasks Vision (@mediapipe/tasks-vision) requires WebGL2 for image preprocessing regardless of delegate setting — even `delegate:"CPU"` calls `gl.activeTexture()` internally. When WebGL2 is unavailable (VMs, CI, no GPU, hardware acceleration disabled), it crashes with "Cannot read properties of undefined (reading 'activeTexture')" at the first `detect()` call rather than at init, making the root cause non-obvious. Its static imports also break Cloudflare Workers SSR at module-evaluation time.
- **Rule**: Before using @mediapipe/tasks-vision, verify `document.createElement('canvas').getContext('webgl2') !== null`. If WebGL2 is unavailable or the environment is uncertain, use @tensorflow-models/pose-detection with @tensorflow/tfjs-backend-cpu — a pure-JS CPU path with zero WebGL dependency. Always load TF.js packages via dynamic `import()` to keep them out of the Cloudflare Workers SSR bundle.
- **Applies to**: plan, plan-review, implement, impl-review
