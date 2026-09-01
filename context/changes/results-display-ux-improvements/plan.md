# Round Over-Precise Body Angles — Implementation Plan

## Overview

The fitting results page (`/sessions/[id]`) renders each body angle's raw floating-point value directly (e.g. `120.36403496308388 degrees`), undermining the plain-language readability FR-008 calls for. This plan adds a small rounding helper and wires it into the one place body angles are rendered, so users see whole-degree values with a `°` symbol instead of raw trig output.

## Current State Analysis

- `src/pages/sessions/[id].astro:72-95` is the only place in the codebase that renders a body-angle number to the UI. Line 77 interpolates `{angle.value}` with no rounding.
- `angle.value` originates in `src/components/VideoAnalyzer.tsx` from `jointAngle()` (`Math.acos(...) * (180 / Math.PI)`) and `computeTorsoAngle()` (`Math.atan2(...) * (180 / Math.PI)`) — both trig-derived, full float precision, stored verbatim in the `analysis_results.body_angles` JSONB column with no DB-level rounding or precision constraint.
- `reference_min`/`reference_max` come from hardcoded integer constants in `VideoAnalyzer.tsx`'s `ANGLE_REFS` (e.g. `{ min: 137, max: 147 }`) — always whole numbers today, but nothing in `bodyAngleSchema` (`src/lib/schemas.ts:13-19`) constrains this, so it's a convention, not a guarantee.
- The in/out-of-range badge (`inRange`, computed at `[id].astro:42`) already compares against the raw, unrounded `angle.value` — this logic is correct today and must not change.
- No formatting/rounding utility exists anywhere in `src/lib/` (`utils.ts` contains only `cn()`).
- A separate, unrelated `.toFixed(1)` call exists in `src/lib/services/llm.ts:166`, formatting angles into the text sent to the recommendations LLM. This is server-side prompt text, never rendered to the user, and out of scope for this change.
- No test runner is configured in this repo (no `test` script, no vitest/jest/playwright, zero `.test.`/`.spec.` files anywhere). Prior plans (`fitting-results-display/plan.md`) verify with `npx tsc --noEmit` + scoped `npx eslint <file>`; this plan follows the same convention.

## Desired End State

A user viewing a completed session's results page sees each body angle rounded to the nearest whole degree with a `°` symbol (e.g. `120°`), and its reference range rounded and formatted the same way (e.g. `reference: 137–147°`), matching the roadmap's stated outcome and the whole-degree default in `change.md`. The in/out-of-range badge's correctness is unaffected — it continues to reflect the true, unrounded measurement.

Verify by: completing a real analysis (or seeding a session with a known non-integer angle value) and confirming the rendered page shows a rounded value with `°`, with `npx tsc --noEmit` and `npx eslint` passing clean.

### Key Discoveries:

- Single fix point: `src/pages/sessions/[id].astro:76-80`.
- Closest repo precedent for a small shared display-helper: `src/lib/session-status.ts` — a standalone module in `src/lib/`, consumed identically by an `.astro` page and a React component. This plan's new helper follows the same placement convention.
- `angle.unit` is data-driven (currently always the literal string `"degrees"`) but stored per-record in the DB; changing it to `"°"` at the source (`VideoAnalyzer.tsx`) would leave already-stored sessions inconsistent. The `°` symbol is therefore applied at render time in the template, not sourced from `angle.unit`.

## What We're NOT Doing

- Not changing `VideoAnalyzer.tsx`, `ANGLE_REFS`, or any pipeline/computation code — the underlying angle values remain full-precision in the database; only the display is rounded.
- Not changing the wording "reference" (kept as-is per user decision — only the unit changed from spelled-out "degrees" to the `°` symbol).
- Not changing the in/out-of-range badge computation — it keeps comparing the raw, unrounded `angle.value` against `reference_min`/`reference_max`.
- Not touching `llm.ts`'s `.toFixed(1)` prompt-formatting — that text is never user-facing and is unrelated to this bug.
- Not adding a test runner or first unit test — this repo has none today, and introducing one is a disproportionate setup cost for a single pure function in a UX-polish change.
- Not adding a DB/schema-level precision constraint on `bodyAngleSchema` — out of scope for a display-only fix; the defensive formatting happens at render time instead.

## Implementation Approach

Add one small, pure `formatAngle()` helper in `src/lib/`, then apply it at all three numeric interpolation points in `[id].astro`'s body-angle template (`value`, `reference_min`, `reference_max`), replacing the spelled-out `degrees` unit with a literal `°`. The `inRange` computation (line 42) is left untouched, still operating on the raw `angle.value`.

## Critical Implementation Details

**State sequencing**: `formatAngle()` must only be applied at the render/interpolation point in the template — never to the value used to compute `inRange` (`[id].astro:42`). Rounding before comparing would change fitting-accuracy semantics (a technically-out-of-range measurement could round into looking in-range), which was explicitly rejected in favor of keeping badge correctness tied to the true measurement.

## Phase 1: Round and reformat body angle display

### Overview

Add the rounding helper and wire it into the results page's body-angle rendering.

### Changes Required:

#### 1. New rounding helper

**File**: `src/lib/format-angle.ts`

**Intent**: A single pure function that rounds a body-angle measurement (or reference bound) to the nearest whole degree for display, per the whole-degree precision decided for this change.

**Contract**: Exports `formatAngle(value: number): number`, returning `Math.round(value)`. No I/O, no dependencies — matches the "pure utilities go in `src/lib/`" convention and the `session-status.ts` placement/naming precedent.

#### 2. Wire the helper into the results page

**File**: `src/pages/sessions/[id].astro`

**Intent**: Round all three displayed numbers (`value`, `reference_min`, `reference_max`) for the "Body angles" section and switch the unit from spelled-out `degrees` to the `°` symbol, while leaving the `bodyAngles`/`inRange` computation (lines 39-43) untouched.

**Contract**: Import `{ formatAngle }` from `@/lib/format-angle`. Replace the body of the angle-value paragraph (currently lines 76-80) so it renders `{formatAngle(angle.value)}` followed by a literal `&deg;`, then `(reference: {formatAngle(angle.reference_min)}&ndash;{formatAngle(angle.reference_max)}&deg;)` — matching the existing `&ndash;` HTML-entity convention already used on the same line. Do not source the unit from `angle.unit` (see Key Discoveries — it stays data-driven for storage but the display uses a hardcoded symbol). The word "reference" is unchanged.

### Success Criteria:

#### Automated Verification:

- TypeScript checks pass: `npx tsc --noEmit`
- Lint passes: `npx eslint src/lib/format-angle.ts src/pages/sessions/[id].astro`

#### Manual Verification:

- Complete a real analysis (or open an existing completed session known to have non-integer angle values) and confirm the "Body angles" section shows whole-degree values with `°` (e.g. `120°`, not `120.36403496308388 degrees`)
- Confirm the reference range renders as whole-degree with `°` (e.g. `reference: 137–147°`)
- Confirm the "In range" / "Outside range" badge still matches each angle's true measurement against its reference range (no change from current behavior)
- Confirm the "Recommendations" section above it is unaffected (unchanged copy, unchanged layout)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- None planned — no test runner exists in this repo (see Current State Analysis / What We're NOT Doing). `formatAngle()` is a one-line pure function; correctness is covered by manual verification against real rendered values.

### Manual Testing Steps:

1. Open a completed session's results page and confirm body angles render as whole-degree values with `°`.
2. Confirm reference ranges render the same way (whole-degree, `°`).
3. Confirm the in/out-of-range badge for at least one angle near its reference boundary still reflects the true (unrounded) measurement.
4. Confirm the "Recommendations" section renders unchanged.

## Performance Considerations

None — `Math.round()` is O(1) per value, no additional data fetching or rendering overhead.

## Migration Notes

None — no schema, data, or API changes. Existing stored `body_angles` values are unaffected; only how they're rendered changes.

## References

- Roadmap: `context/foundation/roadmap.md` (S-05: `results-display-ux-improvements`)
- Change identity: `context/changes/results-display-ux-improvements/change.md`
- PRD: `context/foundation/prd.md` (FR-008)
- Prior slice this builds on: `context/changes/fitting-results-display/plan.md` (S-03, built `[id].astro`)
- Fix point: `src/pages/sessions/[id].astro:72-95`
- Data model: `src/types.ts` (`BodyAngle`, `AnalysisResult`)
- Display-helper placement precedent: `src/lib/session-status.ts`
- Unrelated existing precedent for prompt-side rounding (not touched): `src/lib/services/llm.ts:164-168`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Round and reformat body angle display

#### Automated

- [x] 1.1 TypeScript checks pass: `npx tsc --noEmit` — 7003965
- [x] 1.2 Lint passes: `npx eslint src/lib/format-angle.ts src/pages/sessions/[id].astro` — 7003965

#### Manual

- [x] 1.3 Body angles render as whole-degree values with `°` instead of raw floating-point — 7003965
- [x] 1.4 Reference ranges render as whole-degree with `°` — 7003965
- [x] 1.5 In-range/out-of-range badge still matches the true (unrounded) measurement — 7003965
- [x] 1.6 Recommendations section renders unchanged — 7003965
