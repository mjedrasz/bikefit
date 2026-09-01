/**
 * Rounds a body-angle measurement (or reference bound) to the nearest whole
 * degree for display. Pure formatting only — never apply this before
 * computing in/out-of-range comparisons, which must operate on the raw value.
 */
export function formatAngle(value: number): number {
  return Math.round(value);
}
