# Test Harness Bootstrap + Joint-Angle Correctness Implementation Plan

## Overview

Test-plan rollout **Phase 1**, defending the **geometry / convention dimension of Risk
#1**: the joint-angle / keypoint math computes angles that do not match the bike-fitting
reference-frame definitions they are judged against, so every "in range / outside range"
verdict and every fitting recommendation built on them is confidently wrong.

Risk #1 has a second, **reference-band dimension** — *which numeric range* each angle is
judged against (elbow `150–160` road vs `85–95` gravel/hoods, etc.). That is **PRD Open
Question #2 / Roadmap OQ-2, Block: yes**, an owner decision this plan cannot make.
Phase 1 does not resolve it and does not assert against the shipped `ANGLE_REFS` values;
Phase 5 opens a stub `resolve-angle-reference-bands` change to keep it tracked.

This plan does five things:

1. Stands up the project's first test runner (Vitest, via `getViteConfig`).
2. Extracts the un-exported angle math from `src/components/VideoAnalyzer.tsx` into a
   pure, importable `src/lib/pose/` module — behaviour-preserving.
3. Proves each pure function against a hand-constructed geometric oracle and the
   convention statements in the archived reference-angle docs — never against the value
   the code returns today.
4. Fixes the one confirmed correctness bug: `computeTorsoAngle()` returns `180° − true`
   for a left-facing rider.
5. Extracts the in/out-of-range verdict into a pure helper, tests it (including the
   round-vs-raw display contradiction), and fills the test-plan cookbook (§6.1, §6.6)
   and negative-space (§7).

## Current State Analysis

**All trigonometry, keypoint mapping, and extremum selection lives module-scoped and
un-exported inside one React island**, `src/components/VideoAnalyzer.tsx`:

| Symbol | Lines | Pure? | Role |
|---|---|---|---|
| `ANGLE_REFS` | 22–28 | data | The five reference ranges, hard-coded |
| `PoseLandmark` | 40–45 | type | `{ x, y, z, visibility? }` |
| `jointAngle(a,b,c)` | 47–53 | ✅ | 3-point included angle at vertex `b`, degrees |
| `computeTorsoAngle(wl)` | 55–58 | ✅ | `atan2` hip→shoulder vector from horizontal |
| `visible(lm)` | 60–62 | ✅ | `visibility >= 0.5` gate |
| `convertKeypoints(keypoints)` | 103–137 | ✅ | MoveNet COCO-17 → 33-slot array + body-side auto-select |
| BDC/TDC extremum scan | 264–283 | ✅ logic, ❌ as written (welded to `await detectPoseAt`) | "BDC = highest knee angle, TDC = lowest" |
| `seekTo` / `fileToBase64` / `loadVideoElement` / `detectPoseAt` | 64–151 | ❌ I/O | DOM + video + detector |

Grep of the whole `src/` tree confirms nothing else does trig, keypoint, or pose work.
The only angle-adjacent code elsewhere:

- `src/lib/format-angle.ts:6-8` — `formatAngle = Math.round`, display-only, imported only
  by `src/pages/sessions/[id].astro`. Its own doc comment warns: "never apply this
  before computing in/out-of-range comparisons."
- `src/pages/sessions/[id].astro:40-44` — the **in/out-of-range verdict**, computed
  inline as `angle.value >= angle.reference_min && angle.value <= angle.reference_max`,
  imported from nothing.
- `src/lib/services/llm.ts:12-18, 29-37` — the reference ranges duplicated as prose in
  the recommendations system prompt (a 2nd and 3rd copy).
- `src/lib/schemas.ts:13-19` — `bodyAngleSchema`, a type-only shape check with no
  numeric bounds.

**No test runner exists.** `package.json` has `dev`/`build`/`preview`/`lint`/`format`
only. CI runs `lint` + `build`. `@astrojs/check` is installed but never invoked.

**Confirmed findings from research** (`context/changes/testing-angle-correctness/research.md`):

- **`jointAngle()` convention is correct** — included angle at the vertex (180° =
  straight), clamped to `[-1,1]` before `acos` (no `NaN` from float error), and
  numerically verified **reflection-invariant**. Matches every row of
  `bike-fitting-ref-angles.md`. (A *zero-length* vector — two coincident keypoints —
  still yields `0/0 = NaN`; callers gate on `visible()` but not on coincidence.)
- **`computeTorsoAngle()` has a confirmed left/right-facing bug.** `Math.abs()` folds the
  sign but not the 180° complement. Verified numerically (hip at (100,300), true lean
  50°): right-facing → `50.00`, left-facing → `130.00`. A perfectly-fitted left-facing
  rider is scored "Outside range" against `45–55` and the LLM is told "torso far too
  upright." `convertKeypoints` selects the correct body *side* but does **no** coordinate
  mirroring, so facing direction survives in `x` and reaches this formula unhandled.
- **"The server would catch a bad result" — FALSE.** The browser authors both the
  measured `value` *and* the `reference_min`/`reference_max`
  (`VideoAnalyzer.tsx:290-338`). `POST /api/sessions/[id]/results` inserts `body_angles`
  verbatim through the RLS-bypassing service-role client
  (`results.ts:47-52`). No DB `CHECK` on the `body_angles` JSONB column. The verdict is
  then recomputed from those client-authored numbers on the results page.
- **The reference bands are triplicated and contested.** Elbow is `150–160` in code
  (competitive-road convention) vs `85–95` included for gravel/hoods in
  `angle-to-adjustment-guide.md:126-128`, which explicitly flags the conflict. This is
  **PRD Open Question #2, Block: yes** (`prd.md:128`). Geometry/convention assertions do
  not depend on it; range-**membership** assertions do.
- **Torso & elbow are measured from the BDC frame**, but both reference docs define them
  at "cranks horizontal" (3/9 o'clock). No crank-horizontal keyframe is ever detected.
  Practical error is small (torso-to-horizontal moves ~5° across the stroke) but it is a
  real, undocumented deviation from the reference frame.
- **Angles are 2-D image-plane projections.** `convertKeypoints` hard-codes `z = 0`
  (design used MediaPipe `worldLandmarks`; shipped app uses MoveNet 2-D pixels). Valid
  only for a true perpendicular side view. `test-plan.md §7` already excludes third-party
  model / capture-quality accuracy from the suite.

## Desired End State

- `npm test` runs a green Vitest suite locally, self-contained from a fresh checkout
  (`pretest` runs `astro sync`). `npx vitest run` works headless.
- `src/lib/pose/angles.ts` exports `jointAngle`, `computeTorsoAngle`, `visible`,
  `convertKeypoints`, `pickExtremumFrame`, `ANGLE_REFS`, the `PoseLandmark` type, and the
  keypoint-index constants. `VideoAnalyzer.tsx` imports all of them and contains no local
  copies.
- `src/lib/angle-verdict.ts` exports `angleVerdict(value, min, max): boolean`.
  `src/pages/sessions/[id].astro` imports it instead of the inline expression.
- `computeTorsoAngle()` returns the true acute angle from horizontal (0–90°) for **both**
  left- and right-facing riders.
- `src/lib/pose/angles.test.ts` and `src/lib/angle-verdict.test.ts` assert every claim
  against a hand-built oracle: straight limb = 180°, right angle = 90°, a 45°-from-
  horizontal torso = 45° for both facings, mirrored poses produce equal knee/hip/elbow
  angles, `convertKeypoints` picks the higher-visibility side, `pickExtremumFrame` picks
  the documented extremum, `angleVerdict` is inclusive at both bounds.
- `context/foundation/test-plan.md` §6.1 and §6.6 are filled in; §7 lists the accepted
  deviations.
- `npm run lint` and `npx tsc --noEmit` pass. `npm run build` still passes. The
  upload → analysing → results flow still works end to end (manual).

### Key Discoveries

- `getViteConfig()` from `astro/config` is the current documented Vitest integration
  (Astro docs, verified 2026-09-01); a second arg allows Astro-config overrides
  (Astro 4.8+).
- **Astro 6 removed rendering Astro components in Vitest client environments** (`jsdom` /
  `happy-dom`); tests must use `environment: 'node'`. The Phase 1 pure helpers operate on
  plain objects and need no DOM regardless — so `node` is both required and sufficient.
- **Deviation from frozen `test-plan.md` §4.** §4's Stack table lists a "DOM environment
  | happy-dom or jsdom | none yet — see Phase 1" row, on the assumption the pure helpers
  need a DOM global. Research disproved that — all seven extracted functions are pure over
  plain objects — so Phase 1 ships `environment: "node"` and the real `happy-dom` need
  moves to rollout Phase 2 (the I/O helpers). §1–§5 are frozen and only
  `/10x-test-plan --refresh` may edit them, so this plan does **not** touch §4; correcting
  that row is called out in the Phase 5 orchestrator handoff.
- Vitest's default spec glob is `**/*.{test,spec}.?(c|m)[jt]s?(x)` — colocated
  `*.test.ts` next to the unit under test is the zero-config convention.
- eslint `strictTypeChecked` + `projectService` (`eslint.config.js:14-21`) type-checks
  every file under `**/*`, so test files are linted and type-checked. Using explicit
  `import { describe, it, expect } from "vitest"` (no `globals: true`) avoids adding a
  `vitest/globals` types entry to `tsconfig.json` and an eslint env.
- `src/lib/services/llm.ts` imports `OPENROUTER_API_KEY` from `astro:env/server` at
  module top level; that env field is `access: "secret"` **required**. Importing that
  module in a test without the var set will throw. The Phase 1 modules
  (`src/lib/pose/angles.ts`, `src/lib/angle-verdict.ts`, `src/lib/format-angle.ts`,
  `src/lib/utils.ts`) do **not** touch `astro:env` — so the smoke spec imports one of
  those. Env-setup for `astro:env`-touching modules is deferred to rollout Phase 2
  (integration tests).
- `computeTorsoAngle` fix: torso-from-horizontal is 0–90° by geometric definition (the
  rider leans forward), so folding any result > 90° to `180 − θ` is safe and
  direction-agnostic. `atan2(Math.abs(dy), Math.abs(dx))` is an equivalent one-liner.
- No `context/foundation/roadmap.md` item has Change ID `testing-angle-correctness` —
  this is a test-plan rollout phase, not a roadmap slice. Roadmap sync is a no-op.

## What We're NOT Doing

- **No integration or e2e tests.** API routes, mocked Supabase / OpenRouter, the
  two-user ownership pattern, and the Playwright smoke are rollout Phases 2 and 4.
- **No DOM environment, no tests for the I/O helpers** (`seekTo`, `loadVideoElement`,
  `fileToBase64`, `detectPoseAt`). `happy-dom` install + config is rollout Phase 2. This
  deviates from frozen `test-plan.md` §4 (see Key Discoveries); §4's DOM-env row is left
  for a `/10x-test-plan --refresh`, not edited here.
- **No `astro:env` test-setup wiring.** Deferred to rollout Phase 2, when the first
  module that imports `astro:env` gets tested.
- **No assertion against the shipped `ANGLE_REFS` values, and no resolution of PRD Open
  Question #2 / Roadmap OQ-2** (authoritative gravel bands, esp. elbow `150–160` vs
  `85–95`). Phase 1 asserts geometry and convention only. `angleVerdict` is tested with
  synthetic bands. OQ-2 is the reference-band dimension of Risk #1 and does not fall off
  the radar: Phase 5 opens a `resolve-angle-reference-bands` stub change and points
  Roadmap OQ-2 at it.
- **No fix to the display/pill contradiction.** The `angleVerdict` spec *documents* it
  (raw `147.4` → verdict `false`, but `formatAngle(147.4)` displays `147°` inside
  `137–147°`); the fix is a display-policy call that pairs with the S-05 rounding work,
  tracked as a follow-up in §6.6 and §7.
- **No third keyframe detection** for a crank-horizontal torso/elbow frame. Documented as
  an accepted deviation in §7.
- **No rotated / off-axis pose fixtures.** The 2-D projection assumption is documented on
  the extracted function, not tested (`test-plan.md §7`).
- **No changes to `src/lib/services/llm.ts`** — the prompt-embedded range copies stay;
  de-duplication is noted as a future cleanup, not done here.
- **No CI wiring, no coverage thresholds, no typecheck gate.** Rollout Phase 4 wires
  gates. This plan only ensures the commands pass locally.
- **No server-side validation hardening** (`bodyAngleSchema` bounds, DB `CHECK`). Rollout
  Phases 2/3.
- **No `.skip` / `.fails` specs.** The torso spec is written to fail, then made to pass
  by the fix in the same phase.

## Implementation Approach

Five phases, each with a clean verification boundary:

1. **Bootstrap** gives a green runner with one trivial spec — proves `getViteConfig`,
   the `@/*` alias, TypeScript, and eslint all cooperate before any real test is written.
2. **Extraction** is a pure move: code leaves `VideoAnalyzer.tsx`, gets `export`, is
   imported back. Zero behaviour change — the torso bug moves intact. Verified by
   `build` + a manual pipeline run, so a later failing spec is unambiguously a spec
   problem, not a refactor regression.
3. **Correctness specs + torso fix** writes the oracle-driven suite. The torso
   45°-both-facings spec fails on the extracted-but-unfixed code; the ~1-line fix makes
   it green. All other specs pass against the already-correct `jointAngle` /
   `convertKeypoints` / `pickExtremumFrame`.
4. **Verdict helper** extracts `angleVerdict` from the `.astro` page, tests inclusive
   bounds and pins the round-vs-raw contradiction as documented-known.
5. **Cookbook** turns the now-shipped patterns into `test-plan.md` §6.1 / §6.6 and adds
   the accepted deviations to §7.

## Critical Implementation Details

**Extraction must be byte-for-byte behaviour-preserving (Phase 2).** Every downstream
reader uses only 33-slot indices `11, 13, 15, 23, 25, 27`. `convertKeypoints` writes the
*chosen physical side* into those *MediaPipe LEFT-side* slots regardless of which side was
detected — this is deliberate and must not be "cleaned up." The vestigial MediaPipe
framing (the project runs MoveNet, never MediaPipe — `lessons.md:19-24`) may be
renamed/commented but not restructured.

**`pickExtremumFrame` signature is a contract (Phase 2).** The current loop interleaves
`await detectPoseAt(...)` with the extremum comparison. Extract only the *pure selection*:
the function receives already-detected candidate landmark sets and returns the pick; the
`await` stays in the component. Proposed:
`pickExtremumFrame(candidates: PoseLandmark[][], type: "BDC" | "TDC"): PoseLandmark[] | null`
— for `"BDC"` return the candidate with the highest `jointAngle(wl[23], wl[25], wl[27])`,
for `"TDC"` the lowest; skip any candidate failing `visible()` on slots 23/25/27; return
`null` if none qualify.

**Tie-break and outer-loop semantics are part of the "byte-for-byte" contract (Phase 2).**
The current scan (`VideoAnalyzer.tsx:260–284`) uses strict `>` / `<` seeded at `∓Infinity`,
so on an exact knee-angle tie the **first (earliest-offset) candidate wins**.
`pickExtremumFrame` must reproduce this exactly — keep the strict comparison and the
`∓Infinity` seed; do **not** switch to `>=` / `<=` or a naive `reduce`. The outer
`for (const { t, type } of timestamps)` loop and its
`if (type === "BDC" && bdcLandmarks) continue` /
`if (type === "TDC" && tdcLandmarks) continue` first-non-null-pick-wins guards are copied
**verbatim** into the island. `pickExtremumFrame` is called **once per timestamp** on that
timestamp's ≤5 offset candidates — never on a single array pooled across all BDC (or all
TDC) timestamps, which would pick a global extremum instead of the first usable
timestamp's extremum and change the measured frame for any multi-BDC/TDC video.

**The oracle never comes from current output (Phase 3).** Every expected value is either
hand-derived from geometry (a straight limb is 180°; a right angle is 90°; a hip→shoulder
line 45° above horizontal is 45°) or quoted from `bike-fitting-ref-angles.md`. No
`toMatchSnapshot`, no "assert it returns what it returns today," no real-video keypoint
dumps.

**The torso spec fails before the fix (Phase 3).** Write the `computeTorsoAngle`
left-facing 45° case → expect `45 ± tol`; run it; confirm it fails with `~135` (and every
other left-facing torso assertion — 50°, near-horizontal, near-vertical — fails likewise,
returning `180 − true`); then apply the fold-to-acute fix; confirm green. The fix ships in
the same phase per the decision to land fix + test together.

**`astro:env` boundary (Phase 1).** The smoke spec must import a module that does not
transitively import `astro:env` — use `@/lib/format-angle` or `@/lib/utils`.
`getViteConfig` needs `astro sync` to have run for the `astro:env` virtual module to
resolve, and `.astro/` is gitignored with no `prepare`/`pretest` script today, so a fresh
`git clone && npm install && npm test` would fail puzzlingly at virtual-module resolution.
**Decision: add `"pretest": "astro sync"` to `package.json`** (npm runs it automatically
before `test`; ~1s per run; CI already runs `astro sync` as its own step so no CI change).
Do **not** add an `astro:env` setup file this phase — the smoke spec avoids `astro:env`
entirely.

## Phase 1: Test Harness Bootstrap

### Overview

Install and configure Vitest so `npm test` runs a green suite that resolves the `@/*`
alias and Astro's Vite plugin chain. No production code changes.

### Changes Required

#### 1. Vitest dependency

**File**: `package.json`

**Intent**: Add Vitest as a dev dependency and expose `test` / `test:watch` scripts so
contributors and later CI have a single command.

**Contract**: New `devDependencies` entry for `vitest` (pin an exact version that
resolves against the repo's `vite@^7.3.2` override and Astro 6's `getViteConfig` — Vitest
`3.2.x` is the conservative pick; `4.x` is acceptable if `getViteConfig` merges cleanly,
confirm during implement). New scripts: `"test": "vitest run"`, `"test:watch": "vitest"`,
and `"pretest": "astro sync"` so `npm test` is self-contained from a fresh checkout (the
`astro:env` virtual module `getViteConfig` needs won't resolve without a prior sync, and
`.astro/` is gitignored). No `@vitest/coverage-*` this phase.

#### 2. Vitest config

**File**: `vitest.config.ts` (new, repo root)

**Intent**: Wire Vitest through Astro so `astro:env`, the `@/*` alias, and the Tailwind /
React plugin chain resolve in tests.

**Contract**:

```ts
/// <reference types="vitest/config" />
import { getViteConfig } from "astro/config";

export default getViteConfig({
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
  },
});
```

`environment: "node"` is required by Astro 6 and sufficient for the pure helpers. Restrict
`include` to `src/**` so `context/` and `node_modules` are never scanned.

#### 3. Smoke spec

**File**: `src/lib/format-angle.test.ts` (new)

**Intent**: Prove the runner resolves the `@/*` alias and TypeScript before any real
test depends on it. This spec is kept permanently as the `formatAngle` unit test.

**Contract**: `import { formatAngle } from "@/lib/format-angle"` (alias-path import, not
relative). Assert `formatAngle(147.4) === 147` and `formatAngle(136.6) === 137`. Two
plain `expect` calls.

#### 4. Lint / ignore hygiene

**File**: `eslint.config.js` (verify only — likely no change), `.gitignore` (verify)

**Intent**: Confirm test files lint under the existing `strictTypeChecked` config and
that no `coverage/` or Vitest cache dir needs ignoring yet.

**Contract**: If `projectService` rejects `vitest.config.ts` (not in a tsconfig
`include`), add it to `tsconfig.json` `include` or an eslint `ignores` entry — decide
during implement based on the actual lint error. No `globals: true`.

### Success Criteria

#### Automated Verification

- `npm install` succeeds with the new dependency
- `npm test` exits 0 from a clean state (`rm -rf .astro` first — `pretest` runs
  `astro sync`) and reports the smoke spec passing
- `npx vitest run` works headless (no watch)
- `npm run lint` passes with the new `.ts` files present
- `npx tsc --noEmit` passes
- `npm run build` still passes

#### Manual Verification

- `npm run test:watch` starts watch mode and re-runs on edit
- The smoke spec fails loudly if the `@/*` alias is broken (temporarily break it to
  confirm, then revert)

**Implementation Note**: After automated verification passes, pause for manual
confirmation before Phase 2.

---

## Phase 2: Extract the Pure Pose-Math Module

### Overview

Move all pure angle / keypoint / extremum logic out of `VideoAnalyzer.tsx` into
`src/lib/pose/angles.ts` and import it back. No behaviour change — the torso bug moves
intact and is fixed in Phase 3.

### Changes Required

#### 1. New pose-math module

**File**: `src/lib/pose/angles.ts` (new)

**Intent**: House every pure function the analysis pipeline needs, so they can be unit
tested and imported by both the island and (later) other consumers. Location matches
`CLAUDE.md` — "pure utilities (no I/O) go in `src/lib/`."

**Contract**: Named exports, semantics **identical** to the current
`VideoAnalyzer.tsx` definitions:

- `type PoseLandmark = { x: number; y: number; z: number; visibility?: number }`
- `jointAngle(a: PoseLandmark, b: PoseLandmark, c: PoseLandmark): number` — unchanged
  (keep the `{x,y,z}` signature; `z` is `0` in practice but the 3-D signature is
  future-proofing — document the 2-D-projection assumption in a doc comment).
- `computeTorsoAngle(wl: PoseLandmark[]): number` — **moved unchanged** (the bug travels
  with it; fixed in Phase 3).
- `visible(lm: PoseLandmark | undefined): boolean` — unchanged.
- `convertKeypoints(keypoints: poseDetection.Keypoint[]): PoseLandmark[]` — unchanged
  33-slot remap + side auto-select. The `poseDetection` name is brought in with
  `import type * as poseDetection from "@tensorflow-models/pose-detection"` — **type-only**,
  matching `VideoAnalyzer.tsx:2`. A value import would pull TF.js into the SSR bundle and
  break the Cloudflare adapter (`lessons.md:19-24`); criterion 2.3's `npm run build`
  guards it.
- `pickExtremumFrame(candidates: PoseLandmark[][], type: "BDC" | "TDC"): PoseLandmark[] | null`
  — the pure selection lifted from lines 264–283 (see Critical Implementation Details for
  the exact rule).
- `ANGLE_REFS` — moved verbatim; re-exported. Doc comment cross-references
  `angleVerdict` (`src/lib/angle-verdict.ts`) as the consumer that judges measured values
  against these bands, so the two angle modules are discoverable from each other.
- Keypoint-index constants: name the COCO-17 side indices and the MediaPipe target slots
  as named `const`s (e.g. `COCO_LEFT`, `COCO_RIGHT`, `MP_SLOTS`) so the specs and the
  remap read from one source.

#### 2. Rewire the island

**File**: `src/components/VideoAnalyzer.tsx`

**Intent**: Delete the local definitions of the six symbols above; import them from
`@/lib/pose/angles`; call `pickExtremumFrame` where the inline extremum loop was.

**Contract**: The `import` replaces lines 22–28 (`ANGLE_REFS`), 40–62 (`PoseLandmark`,
`jointAngle`, `computeTorsoAngle`, `visible`), 103–137 (`convertKeypoints`). The
BDC/TDC scan (260–284) keeps its outer `for (const { t, type } of timestamps)` loop and
both `... && bdcLandmarks) continue` / `... && tdcLandmarks) continue` guards **verbatim**;
inside the loop the `await detectPoseAt` calls stay and their results are collected into a
**per-timestamp** `candidates` array, then `pickExtremumFrame(candidates, type)` replaces
the inline `bestKneeAngle` comparison for that one timestamp's pick. `detectPoseAt` still
calls `convertKeypoints` (now imported). Net computed output for any given video is
unchanged — including which frame wins an exact knee-angle tie.

### Success Criteria

#### Automated Verification

- `npx tsc --noEmit` passes
- `npm run lint` passes (including `react-compiler/react-compiler` and
  `react-hooks/exhaustive-deps` on the modified island)
- `npm run build` passes (module is not pulled into the SSR bundle in a way that breaks
  the Cloudflare adapter — the pure module has no TF.js static import)
- `npm test` still green (smoke spec only; new specs land in Phase 3)

#### Manual Verification

- Upload a real side-view clip through the running app; the pipeline completes and the
  results page shows the same five angles it did before extraction
- The computed values for a re-used test clip match the pre-extraction values (screenshot
  or note them before starting)
- No new console errors in the browser during analysis

**Implementation Note**: After automated verification passes, pause for manual
confirmation that a real pipeline run is unchanged before Phase 3.

---

## Phase 3: Correctness Specs + Torso Direction Fix

### Overview

Write the oracle-driven unit suite for `src/lib/pose/angles.ts`. The torso
45°-both-facings spec fails on the extracted-but-unfixed code; a ~1-line fix makes it
green. Every other spec passes against the already-correct math.

### Changes Required

#### 1. Angle-math spec

**File**: `src/lib/pose/angles.test.ts` (new)

**Intent**: Assert each pure function matches the reference-frame definitions, with the
oracle taken from geometry and `bike-fitting-ref-angles.md` — never from current output.

**Contract**: `describe` blocks per function. Oracle-driven cases:

- **`jointAngle`**
  - straight limb (collinear `a`, `b`, `c` with `b` between) → `180 ± 0.001` — proves
    *included*, not *flexion*
  - right angle (e.g. `a=(0,1)`, `b=(0,0)`, `c=(1,0)`) → `90 ± 0.001`
  - constructed 140° knee → `140 ± 0.01`
  - fully folded (`a` and `c` coincident on one side of `b`) → `~0`
  - reflection invariance: a pose and its `x`-mirror → identical angle
  - clamp guard: inputs that would push `dot/(|ba||bc|)` slightly past `±1` by float
    error → no `NaN`
  - coincident keypoints (`a === b`) → **document** the current `NaN` result in the spec
    with a comment; no fix this phase (noted in §6.6)
- **`computeTorsoAngle`**
  - right-facing rider, hip→shoulder line 45° above horizontal → `45 ± tol`
  - **left-facing rider, same true 45°** → `45 ± tol` — **fails before the fix**
  - 50° both facings (matches the research reproduction) → `50 ± tol`
  - a near-horizontal and a near-vertical torso line, both facings
- **`convertKeypoints`**
  - left-side scores dominate → output slots `11/13/15/23/25/27` come from COCO
    `5/7/9/11/13/15`
  - right-side scores dominate → from COCO `6/8/10/12/14/16`
  - exact tie → left (`leftScore >= rightScore`)
  - a missing keypoint → its slot stays `{ x:0, y:0, z:0, visibility:0 }` and `visible()`
    is `false`
  - mirror invariance: a pose and its `x`-mirror (dominant-side scores swapped) →
    **equal** knee, hip, and elbow angles (torso is excluded — it is the one that must
    be *made* mirror-safe by the fix)
- **`pickExtremumFrame`**
  - three synthetic candidate sets with known knee angles → `"BDC"` returns the
    highest-knee-angle set, `"TDC"` the lowest
  - a candidate failing `visible()` on slot 23/25/27 is skipped
  - no qualifying candidate → `null`
  - two candidates with an **exact** knee-angle tie → the earlier one (lower array index)
    is returned, for both `"BDC"` and `"TDC"` — pins the strict-comparison / `∓Infinity`-seed
    first-wins behaviour copied verbatim from the island
- **`visible`** — `undefined` → `false`; `visibility` `0.49` → `false`; `0.5` → `true`

Fixture helpers (a `makeLandmarks(partial)` builder, a `mirrorX` helper) live at the top
of this spec file; Phase 4+ may promote them to `src/lib/pose/__fixtures__/` — note the
location in §6.6.

#### 2. Torso direction fix

**File**: `src/lib/pose/angles.ts`

**Intent**: Make `computeTorsoAngle` direction-agnostic so a left-facing and a
right-facing clip both resolve to the correct angle from horizontal.

**Contract**: Fold any result greater than 90° to its acute complement, or compute from
absolute components directly. Torso-from-horizontal is 0–90° by definition, so this is
lossless:

```ts
// hip→shoulder vector; direction-agnostic angle from horizontal, 0–90°
const dy = wl[11].y - wl[23].y;
const dx = wl[11].x - wl[23].x;
return Math.atan2(Math.abs(dy), Math.abs(dx)) * (180 / Math.PI);
```

Update the doc comment: remove the stale "world coords" note (leftover from the abandoned
MediaPipe `worldLandmarks` design); state that input is 2-D pixel space, `y` down, and
the result is the acute angle from horizontal valid for a true perpendicular side view.

#### 3. Note the frame deviation

**File**: `src/lib/pose/angles.ts` (doc comment only)

**Intent**: Record that torso and elbow are consumed from the BDC frame by the caller,
while `bike-fitting-ref-angles.md` defines them at cranks-horizontal — an accepted MVP
deviation, not a bug in these functions.

**Contract**: One doc-comment paragraph on `computeTorsoAngle` (and a line on the elbow
usage) pointing at `test-plan.md §7`. No behaviour change.

### Success Criteria

#### Automated Verification

- `npm test` green — all `angles.test.ts` cases pass (torso included, after the fix)
- Reverting only the torso fix fails every left-facing `computeTorsoAngle` assertion (and
  no right-facing one) — proves the spec has real signal — then re-apply
- `npx tsc --noEmit` passes
- `npm run lint` passes
- `npm run build` passes

#### Manual Verification

- Run a **left-facing** clip through the app; the torso angle is now plausible
  (~45–55° for a normally-fitted rider) instead of ~125–135°
- Run a **right-facing** clip; the torso angle is unchanged from before the fix
- The other four angles are unchanged for both clips

**Implementation Note**: After automated verification passes, pause for manual
confirmation (both facings tested) before Phase 4.

---

## Phase 4: Verdict Helper Extraction + Specs

### Overview

Extract the inline in/out-of-range verdict from `sessions/[id].astro` into a pure helper
and unit-test it, including the documented round-vs-raw display contradiction.

### Changes Required

#### 1. New verdict helper

**File**: `src/lib/angle-verdict.ts` (new)

**Intent**: Give the "in range / outside range" decision — the verdict Risk #1 names — a
single pure, testable home. Deliberately a **leaf module**, not part of
`src/lib/pose/angles.ts`: the only consumer is the Astro SSR results page
(`sessions/[id].astro`), and a leaf import keeps the browser-pipeline pose-math module out
of that page's server render.

**Contract**: `angleVerdict(value: number, min: number, max: number): boolean` returning
`value >= min && value <= max` (inclusive both ends — identical to the current inline
expression). Doc comment: operates on the **raw** stored value, never a rounded one;
cross-references `formatAngle` and the known display contradiction, and names
`ANGLE_REFS` (in `src/lib/pose/angles.ts`) as the source of the `min`/`max` bands this is
applied against.

#### 2. Rewire the results page

**File**: `src/pages/sessions/[id].astro`

**Intent**: Replace the inline boolean at line 43 with the imported helper. No visual or
behavioural change.

**Contract**: `import { angleVerdict } from "@/lib/angle-verdict"`; the `bodyAngles` map
uses `inRange: angleVerdict(angle.value, angle.reference_min, angle.reference_max)`.

#### 3. Verdict spec

**File**: `src/lib/angle-verdict.test.ts` (new)

**Intent**: Assert inclusive-bound behaviour and pin the display/pill contradiction as
documented-known — with **synthetic** bands, not the shipped `ANGLE_REFS` (per the
decision to keep Phase 1 clear of PRD Open Question #2).

**Contract**:

- `angleVerdict(140, 137, 147)` → `true`; `angleVerdict(137, 137, 147)` → `true`
  (inclusive min); `angleVerdict(147, 137, 147)` → `true` (inclusive max)
- `angleVerdict(136.9, 137, 147)` → `false`; `angleVerdict(147.1, 137, 147)` → `false`
- **Contradiction cases** (with a comment explaining these are documented-known, not a
  bug being fixed here): `angleVerdict(147.4, 137, 147)` → `false` while
  `formatAngle(147.4)` → `147`, which the page renders inside "137–147°";
  `angleVerdict(136.6, 137, 147)` → `false` while `formatAngle(136.6)` → `137`. Link the
  follow-up: §6.6 / §7.
- inverted bounds (`min > max`) → always `false` — documents that the helper does not
  guard the client-authored bounds (server-side validation is a later rollout phase)

### Success Criteria

#### Automated Verification

- `npm test` green — all `angle-verdict.test.ts` cases pass
- `npx tsc --noEmit` passes
- `npm run lint` passes
- `npm run build` passes

#### Manual Verification

- The results page for a completed session renders the same pills and numbers as before
  the extraction (compare against a screenshot)

**Implementation Note**: After automated verification passes, pause for manual
confirmation before Phase 5.

---

## Phase 5: Cookbook + Negative-Space Update

### Overview

Turn the shipped patterns into the durable answer to "how do I add a unit test here?" and
record the accepted deviations.

### Changes Required

#### 1. Fill cookbook §6.1

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the `§6.1` placeholder with the concrete pattern this phase
established.

**Contract**: §6.1 now states: specs are **colocated** as `*.test.ts` next to the unit
(`src/lib/pose/angles.test.ts` beside `angles.ts`); run with `npm test` (`vitest run`) or
`npm run test:watch`; the **canonical reference test** is the joint-angle / keypoint
pattern — construct keypoint fixtures, assert the returned value against a number derived
from geometry or quoted from
`context/archive/2026-05-28-ai-analysis-pipeline/bike-fitting-ref-angles.md`, **never**
against current output or a snapshot; `environment: "node"`, no DOM; fixture builders in
the spec file (or `src/lib/pose/__fixtures__/` once shared). Point at
`src/lib/pose/angles.test.ts` and `src/lib/angle-verdict.test.ts` as the worked examples.

#### 2. Fill cookbook §6.6

**File**: `context/foundation/test-plan.md`

**Intent**: Record what this phase taught for future phases.

**Contract**: §6.6 note for Phase 1 covering: the extraction pattern (pure logic out of
islands into `src/lib/`), the `astro:env` import hazard and why the smoke spec avoids it,
the fixture-builder location, the torso fix that shipped with the spec, and the two
open follow-ups — (a) the display/pill boundary contradiction awaits a display-policy
decision alongside S-05's rounding work, (b) `jointAngle` returns `NaN` for coincident
keypoints (callers gate on `visible()` only).

#### 3. Extend negative-space §7

**File**: `context/foundation/test-plan.md`

**Intent**: Record the deviations this phase accepted rather than fixed.

**Contract**: New §7 bullets: torso & elbow are measured from the BDC frame, not
cranks-horizontal as the reference defines — practical error small, closing it needs a
third keyframe (out of MVP); angles are 2-D image-plane projections valid only for a true
perpendicular side view (third-party capture quality, already excluded); the results-page
display/pill contradiction near a reference boundary is known and tracked, not yet fixed;
this phase defends only the **geometry/convention** dimension of Risk #1 — the
**reference-band** dimension (which numeric range each angle is judged against) is
unresolved owner decision OQ-2, tracked as change `resolve-angle-reference-bands`.

#### 4. Track Roadmap OQ-2 (reference bands) as an owner decision

**File**: `context/changes/resolve-angle-reference-bands/change.md` (new stub),
`context/foundation/roadmap.md`

**Intent**: The reference-band dimension of Risk #1 — *which* numeric range each angle is
judged against — is an unresolved owner decision (PRD OQ#2 / Roadmap OQ-2, Block: yes)
that S-02 shipped without. Once §3 Phase 1 is marked `complete`, "Risk #1 defended" must
not be read as covering it; give it a durable home.

**Contract**: Hand-create `context/changes/resolve-angle-reference-bands/` with a
`change.md` (same frontmatter shape as this change's — `status: open`,
`created`/`updated` = implement date, `archived_at: null`). Body states: the bands are
triplicated and contested (code `150–160` competitive-road vs `85–95` gravel/hoods in
`context/archive/2026-05-28-ai-analysis-pipeline/angle-to-adjustment-guide.md:126–128`,
which flags the conflict); the owner decision needed is the authoritative gravel
road-position bands for all five angles, sourced from bike-fitting literature or a
certified-fitter consult per Roadmap OQ-2. Link back to this plan, `test-plan.md §7`, and
`prd.md` OQ#2. **No implementation — tracking only.** Then edit `roadmap.md` Open Roadmap
Question 2 to append: "Tracked as change `resolve-angle-reference-bands` (opened
<implement date>); still unresolved."

#### 5. Frontmatter + roadmap

**File**: `context/foundation/test-plan.md`, `context/changes/testing-angle-correctness/change.md`

**Intent**: Stamp the docs.

**Contract**: `test-plan.md` header `Last updated:` → the implement date. `change.md`
`status:` → `implemented` (or per `/10x-implement` convention), `updated:` → date. The
only `roadmap.md` edit is the OQ-2 pointer from change #4 — no roadmap *slice* row
changes (no matching Change ID for this rollout phase — confirmed).

### Success Criteria

#### Automated Verification

- `npm test` green (full suite)
- `npm run lint` passes
- `npx tsc --noEmit` passes
- `npm run build` passes
- `context/foundation/test-plan.md` §6.1 and §6.6 no longer contain "TBD — see §3
  Phase 1"
- `context/changes/resolve-angle-reference-bands/change.md` exists and `roadmap.md`
  Open Roadmap Question 2 points at it

#### Manual Verification

- A reader unfamiliar with the project can follow §6.1 to add a new pure-logic unit test
  without asking where specs go or where the oracle comes from
- §7 reflects what the team actually believes about the deviations

**Implementation Note**: After this phase, re-invoke `/10x-test-plan` to advance the
rollout (it flips §3 Phase 1 to `complete` and presents Phase 2). **Flag to the
orchestrator/user**: frozen §4's "DOM environment … see Phase 1" row is now stale — Phase
1 shipped `environment: "node"` and the `happy-dom` need moved to Phase 2. That row needs
a `/10x-test-plan --refresh` to correct; §5 here does not edit §1–§5.

---

## Testing Strategy

### Unit Tests

- **`jointAngle`** — included-angle convention (straight = 180, right = 90, constructed
  140 = 140), reflection invariance, clamp safety, coincident-keypoint `NaN` documented.
- **`computeTorsoAngle`** — 45° / 50° from horizontal → same result for left- and
  right-facing; near-horizontal and near-vertical edge lines.
- **`convertKeypoints`** — higher-visibility side wins, tie → left, missing keypoint →
  zeroed slot, mirror invariance of knee/hip/elbow.
- **`pickExtremumFrame`** — BDC picks max knee angle, TDC picks min, invisible candidates
  skipped, empty → `null`, exact tie → earlier candidate wins (both types).
- **`angleVerdict`** — inclusive at both bounds, out just outside, the two documented
  display-contradiction cases, inverted-bounds behaviour.
- **`formatAngle`** — the smoke spec (kept).

### Integration Tests

None this phase (rollout Phase 2).

### Manual Testing Steps

1. `npm test` — full suite green.
2. Temporarily revert the torso fix → exactly the left-facing torso cases fail → re-apply.
3. Upload a **left-facing** side-view clip in the running app → torso angle is now
   plausible (was ~125–135°).
4. Upload a **right-facing** clip → all five angles unchanged from pre-change values.
5. Open a completed session's results page → pills and numbers identical to before.
6. `npm run build` → passes; no Cloudflare adapter / bundle regression.

## Performance Considerations

Negligible. The extracted functions are the same arithmetic, now behind one module
boundary. Vitest adds a dev dependency and a local command; no runtime or bundle impact
(the pure module carries no TF.js static import — TF.js stays dynamically imported in the
island).

## Migration Notes

No data migration. The extraction is behaviour-preserving; the torso fix changes computed
output for **left-facing videos only** — historical `analysis_results` rows for
left-facing clips retain their wrong stored torso value (the app does not recompute
persisted results). This is acceptable for MVP: no backfill, and the wrong historical
values were already user-visible. Note it in the phase-5 §6.6 entry.

## References

- Research: `context/changes/testing-angle-correctness/research.md`
- Change brief: `context/changes/testing-angle-correctness/change.md`
- Test plan: `context/foundation/test-plan.md` §1 (principles), §2 (Risk #1 response),
  §4 (stack), §6.1 / §6.6 (cookbook this fills), §7 (exclusions)
- Reference-angle definitions (the oracle):
  `context/archive/2026-05-28-ai-analysis-pipeline/bike-fitting-ref-angles.md`,
  `context/archive/2026-05-28-ai-analysis-pipeline/angle-to-adjustment-guide.md`
- Current math: `src/components/VideoAnalyzer.tsx:22-62, 103-137, 251-339`
- Verdict path: `src/pages/sessions/[id].astro:40-44`; `src/lib/format-angle.ts`
- Lessons: `context/foundation/lessons.md` (`npx tsc --noEmit`, `z.treeifyError`, TF.js
  CPU backend)
- Astro Vitest setup: Astro docs "Testing" guide — `getViteConfig`, `environment: 'node'`
  (Astro 6), verified via Context7 2026-09-01

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.
> Do not rename step titles.

### Phase 1: Test Harness Bootstrap

#### Automated

- [x] 1.1 `npm install` succeeds with the new dependency — 87d26b3
- [x] 1.2 `npm test` exits 0 from a clean state (`rm -rf .astro`; `pretest` runs `astro sync`) and reports the smoke spec passing — 87d26b3
- [x] 1.3 `npx vitest run` works headless — 87d26b3
- [x] 1.4 `npm run lint` passes with the new `.ts` files present — 87d26b3
- [x] 1.5 `npx tsc --noEmit` passes — 87d26b3
- [x] 1.6 `npm run build` still passes — 87d26b3

#### Manual

- [x] 1.7 `npm run test:watch` starts watch mode and re-runs on edit — 87d26b3
- [x] 1.8 Smoke spec fails loudly when the `@/*` alias is broken, then reverted — 87d26b3

### Phase 2: Extract the Pure Pose-Math Module

#### Automated

- [x] 2.1 `npx tsc --noEmit` passes — 2232f65
- [x] 2.2 `npm run lint` passes (react-compiler + react-hooks on the modified island) — 2232f65
- [x] 2.3 `npm run build` passes — 2232f65
- [x] 2.4 `npm test` still green — 2232f65

#### Manual

- [x] 2.5 A real clip run through the app produces the same five angles as before — 2232f65
- [x] 2.6 Computed values for a re-used test clip match pre-extraction values — 2232f65
- [x] 2.7 No new browser console errors during analysis — 2232f65

### Phase 3: Correctness Specs + Torso Direction Fix

#### Automated

- [x] 3.1 `npm test` green — all `angles.test.ts` cases pass (torso after the fix)
- [x] 3.2 Reverting only the torso fix fails every left-facing torso assertion (no right-facing one), then re-applied
- [x] 3.3 `npx tsc --noEmit` passes
- [x] 3.4 `npm run lint` passes
- [x] 3.5 `npm run build` passes

#### Manual

- [x] 3.6 Left-facing clip: torso angle now plausible (~45–55°) instead of ~125–135°
- [x] 3.7 Right-facing clip: torso angle unchanged from before the fix
- [x] 3.8 The other four angles unchanged for both clips

### Phase 4: Verdict Helper Extraction + Specs

#### Automated

- [ ] 4.1 `npm test` green — all `angle-verdict.test.ts` cases pass
- [ ] 4.2 `npx tsc --noEmit` passes
- [ ] 4.3 `npm run lint` passes
- [ ] 4.4 `npm run build` passes

#### Manual

- [ ] 4.5 Results page renders the same pills and numbers as before the extraction

### Phase 5: Cookbook + Negative-Space Update

#### Automated

- [ ] 5.1 `npm test` green (full suite)
- [ ] 5.2 `npm run lint` passes
- [ ] 5.3 `npx tsc --noEmit` passes
- [ ] 5.4 `npm run build` passes
- [ ] 5.5 `test-plan.md` §6.1 and §6.6 no longer contain "TBD — see §3 Phase 1"
- [ ] 5.6 `context/changes/resolve-angle-reference-bands/change.md` exists and `roadmap.md` OQ-2 points at it

#### Manual

- [ ] 5.7 A reader can follow §6.1 to add a pure-logic unit test unaided
- [ ] 5.8 §7 reflects the team's actual belief about the deviations
