/**
 * The in/out-of-range verdict for a measured body angle — the "in range / outside
 * range" decision that Risk #1 names. Returns `true` when `value` sits within the
 * inclusive band `[min, max]`, identical to the expression this replaced inline in
 * `src/pages/sessions/[id].astro`.
 *
 * Operates on the **raw** stored measurement, never a rounded one. `formatAngle`
 * (`src/lib/format-angle.ts`) rounds to the nearest whole degree for display only, and
 * applying it first would flip the verdict near a boundary: a raw `147.4` is
 * `angleVerdict(147.4, 137, 147) === false`, yet `formatAngle(147.4)` renders `147°`,
 * which reads as inside "137–147°". That display/pill contradiction is known and tracked
 * — see `context/foundation/test-plan.md` §6.6 / §7 — not fixed here.
 *
 * The `min`/`max` bands come from `ANGLE_REFS` in `src/lib/pose/angles.ts`, whose
 * authoritative source of record is `context/foundation/reference-angles.md` (resolves PRD
 * Open Question #2 / Roadmap OQ-2). This helper does **not** guard its inputs: `value` and
 * the bounds are all authored client-side by the browser pipeline and
 * persisted verbatim; server-side validation of that shape is a later test-plan rollout
 * phase. Inverted bounds (`min > max`) therefore always yield `false`.
 */
export function angleVerdict(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}
