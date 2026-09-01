# Round Over-Precise Body Angles — Plan Brief

> Full plan: `context/changes/results-display-ux-improvements/plan.md`

## What & Why

The fitting results page shows body angles as raw floating-point numbers (e.g. `120.36403496308388 degrees`) instead of readable, plain-language values. This is S-05 on the BikeFit roadmap — a display-only polish of the results page built in S-03, closing the gap between what the pipeline computes and what FR-008 ("plain language ... for context") calls for.

## Starting Point

`src/pages/sessions/[id].astro` already renders recommendations and body angles from `analysis_results` (built in `fitting-results-display`, S-03). The only defect is line 77: `{angle.value}` is interpolated with no rounding. `reference_min`/`reference_max` are always whole numbers today (hardcoded constants), but nothing guarantees that going forward.

## Desired End State

A user viewing their completed results sees each body angle rounded to the nearest whole degree with a `°` symbol (e.g. `120°`, reference `137–147°`), instead of a raw trig-derived float. The in/out-of-range badge is unaffected — it still reflects the true, unrounded measurement.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Rounding precision | Whole degree (`Math.round`) | Matches `change.md`'s default and the PRD FR-008 example (`"142°"`) | Change.md / Plan |
| Copy scope | Switch `degrees` → `°` symbol; keep the word "reference" | User chose a partial alignment with the PRD example, not a full copy rewrite | Plan (user Q&A) |
| Formatter reach | Apply to `value`, `reference_min`, and `reference_max` alike | Reference bounds are integers only by convention today, not by schema guarantee — one shared helper prevents this exact bug from resurfacing if a reference range ever becomes non-integer | Plan (user Q&A) |
| Badge basis | Keep comparing the raw, unrounded `angle.value` | Badge correctness must track the true measurement, not a display rounding — a display fix shouldn't change fitting-accuracy semantics | Plan (user Q&A) |
| Testing approach | Automated (`tsc --noEmit` + `eslint`) + manual only, no new test runner | Repo has zero test infrastructure today; standing one up for a single pure function is disproportionate to this change | Plan (user Q&A) |

## Scope

**In scope:**
- `src/lib/format-angle.ts` (new) — `formatAngle(value: number): number`, rounds to nearest whole degree
- `src/pages/sessions/[id].astro` — round `value`/`reference_min`/`reference_max` for display, switch unit to `°`

**Out of scope:**
- `VideoAnalyzer.tsx` / `ANGLE_REFS` / angle-computation pipeline (untouched — data stays full precision in the DB)
- The word "reference" or any other copy beyond the unit symbol
- The `inRange` badge computation
- `llm.ts`'s `.toFixed(1)` prompt-formatting (server-side, never user-facing)
- Any test runner setup or DB/schema precision constraints

## Architecture / Approach

A single new pure-function module in `src/lib/` (following the `session-status.ts` placement precedent), applied at the three numeric interpolation points already present in `[id].astro`'s body-angle template. No new API surface, no data model change — purely a render-time formatting fix.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Round and reformat body angle display | New `formatAngle()` helper + wired into the results page, `°` symbol, badge logic untouched | Low — single template edit + one-line helper; the one real risk (accidentally rounding before the badge comparison) is called out explicitly in the plan |

**Prerequisites:** S-03 (`fitting-results-display`) — already done.
**Estimated effort:** ~30–60 minutes, 1 phase.

## Open Risks & Assumptions

- Assumes all current and future body angles are genuinely degree-based (no other unit ever appears) — the `°` symbol is hardcoded at render time rather than sourced from `angle.unit`.
- No automated regression test protects `formatAngle()` — acceptable given it's a one-line `Math.round()` wrapper and the repo has no test runner to anchor one in.

## Success Criteria (Summary)

- Body angles and their reference ranges display as whole-degree values with `°`, not raw floats.
- The in/out-of-range badge continues to reflect the true, unrounded measurement.
- No regressions to the recommendations section or any other part of the results page.
