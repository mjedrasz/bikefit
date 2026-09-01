# Test Harness Bootstrap + Joint-Angle Correctness — Plan Brief

> Full plan: `context/changes/testing-angle-correctness/plan.md`
> Research: `context/changes/testing-angle-correctness/research.md`

## What & Why

Test-plan rollout **Phase 1**, defending **Risk #1**: the app computes joint angles that
don't match the bike-fitting reference-frame definitions they're judged against, so every
"in range / outside range" verdict and every fitting recommendation is confidently wrong.
This stands up the project's first test runner and proves the angle / keypoint math
against a hand-built oracle — then fixes the one confirmed bug it finds.

## Starting Point

All trigonometry, keypoint mapping, and BDC/TDC extremum selection lives module-scoped
and **un-exported** inside one React island, `src/components/VideoAnalyzer.tsx`. Nothing
in `src/` is unit-testable. There is no test runner — `package.json` has
`dev`/`build`/`lint` only; CI runs `lint` + `build`. Research confirmed `jointAngle()`'s
convention is correct, but `computeTorsoAngle()` returns `180° − true` for a left-facing
rider, and the server persists whatever the browser posts with no correctness check.

## Desired End State

`npm test` runs a green Vitest suite. The pure math lives in `src/lib/pose/angles.ts` and
the verdict in `src/lib/angle-verdict.ts`, both imported back into the app with identical
behaviour — except `computeTorsoAngle` now returns the correct acute angle from
horizontal for both facing directions. Specs assert every claim against geometry and the
archived reference-angle docs, never against current output. The test-plan cookbook
(§6.1, §6.6) and negative-space (§7) are filled in.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Torso left/right-facing bug | Fix it **and** land the test together in Phase 3 | The bug is squarely Risk #1, the fix is one line and reflection-symmetric, and the same spec verifies it | Plan |
| In/out-of-range verdict | Extract `angleVerdict()` and unit-test it | It *is* the "in range / outside range verdict" Risk #1 names; pure `(value,min,max)→bool` | Plan |
| Contested reference bands (elbow 150–160 vs 85–95) | Geometry + convention assertions only; no membership assertions against shipped `ANGLE_REFS` | Convention is provably independent of PRD Open Question #2 (Block: yes); unblocks the high-value tests now | Plan |
| Display/pill contradiction (raw 147.4 → "147°" but "Outside range") | Document in a spec, don't fix | It's a display-policy call that pairs with the S-05 rounding work, not the geometry | Plan |
| Extraction surface | Pure helpers + constants **+** `pickExtremumFrame` | The BDC/TDC extremum rule is deterministic and worth a test; the `await` loop stays in the component | Plan |
| DOM environment | `environment: "node"`, defer `happy-dom` to rollout Phase 2 | Astro 6 forbids component render in client envs anyway, and the Phase 1 helpers are pure over plain objects | Plan / Research |

## Scope

**In scope:**
- Vitest via `getViteConfig`, `test` scripts, one smoke spec
- Extract `jointAngle`, `computeTorsoAngle`, `visible`, `convertKeypoints`,
  `pickExtremumFrame`, `ANGLE_REFS`, types + index constants → `src/lib/pose/angles.ts`
- Oracle-driven unit specs (convention, reflection invariance, side-selection, extremum)
- The one-line `computeTorsoAngle` direction fix
- Extract + test `angleVerdict()` from `sessions/[id].astro`
- Fill `test-plan.md` §6.1 / §6.6 / §7

**Out of scope:**
- Integration / e2e tests, DOM env, I/O-helper tests, `astro:env` test-setup (rollout Ph 2/4)
- Resolving PRD Open Question #2 / the elbow band / any assertion on shipped `ANGLE_REFS`
- Fixing the display/pill contradiction; detecting a crank-horizontal keyframe
- Rotated / off-axis pose fixtures; vision-LLM determinism
- CI wiring, coverage thresholds, typecheck gate; server-side validation hardening
- Changes to `llm.ts` prompt copies of the ranges

## Architecture / Approach

`VideoAnalyzer.tsx` loses its private math block; a new pure `src/lib/pose/angles.ts`
gains it as named exports and is imported back (matches `CLAUDE.md` — pure utils in
`src/lib/`). A sibling `src/lib/angle-verdict.ts` holds the extracted verdict, imported by
the results page. Specs colocate as `*.test.ts`. Vitest runs through Astro's
`getViteConfig` in `environment: "node"` so the `@/*` alias and plugin chain resolve. The
oracle is geometry + the archived `bike-fitting-ref-angles.md` — no snapshots, no
current-output assertions.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Harness bootstrap | Green Vitest suite, one smoke spec, `test` scripts | `getViteConfig` / `astro:env` resolution in a Cloudflare-adapter project |
| 2. Extract pose-math module | `src/lib/pose/angles.ts`, island rewired, zero behaviour change | An accidental behaviour change in `convertKeypoints`'s 33-slot remap or the extremum loop |
| 3. Correctness specs + torso fix | Oracle-driven suite; `computeTorsoAngle` fixed for both facings | Getting the oracle wrong (must be geometry, not current output); historical rows keep wrong torso values |
| 4. Verdict helper + specs | `angleVerdict()` extracted from `.astro`, tested | Touching an SSR page; the round-vs-raw contradiction must be documented, not silently "fixed" |
| 5. Cookbook + §7 | `test-plan.md` §6.1 / §6.6 / §7 filled | Cookbook too thin to be the canonical answer `/10x-tdd` reads later |

**Prerequisites:** none — research is complete; no roadmap dependency (this is a
test-plan rollout phase, not a roadmap slice).
**Estimated effort:** ~3–4 sessions across 5 phases (phases 1, 4, 5 are small).

## Open Risks & Assumptions

- Vitest 3.2.x vs 4.x compatibility with Astro 6's `getViteConfig` + `vite@7` — pinned
  during implement; 3.2.x is the conservative fallback.
- `getViteConfig` may need `npx astro sync` to have run for the `astro:env` virtual
  module to resolve; the smoke spec sidesteps this by importing a leaf util.
- The torso fix assumes torso-from-horizontal is always 0–90° (rider leans forward) — a
  safe geometric definition; folding results > 90° to `180 − θ` is lossless.
- Historical `analysis_results` rows for left-facing clips keep their wrong stored torso
  value — no backfill (accepted; those values were already user-visible).

## Success Criteria (Summary)

- `npm test` runs a green suite; reverting the torso fix fails exactly the left-facing
  torso cases (the spec has real signal).
- A left-facing clip through the running app now shows a plausible torso angle
  (~45–55°) instead of ~125–135°; right-facing and the other four angles are unchanged.
- The extracted verdict and pose math produce byte-identical results on the results page
  and in a real pipeline run.
- `test-plan.md` §6.1 is a concrete "how to add a pure-logic unit test here" that a new
  contributor can follow unaided.
