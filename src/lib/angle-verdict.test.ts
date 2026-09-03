import { describe, it, expect } from "vitest";
import { angleVerdict } from "@/lib/angle-verdict";
import { formatAngle } from "@/lib/format-angle";

// Unit suite for the in/out-of-range verdict. Bands here are **synthetic** — chosen as
// convenient round examples, not tied to any shipped reference band — and exercise the
// generic inclusive-bound contract (strictly inside, both boundaries, just outside,
// inverted bounds) plus the known display/pill contradiction near a boundary
// (test-plan.md §6.6 / §7). The blessed `ANGLE_REFS` values themselves are pinned in
// `src/lib/pose/angles.test.ts` against `context/foundation/reference-angles.md`.

describe("angleVerdict", () => {
  it("is true for a value strictly inside the band", () => {
    expect(angleVerdict(140, 137, 147)).toBe(true);
  });

  it("is inclusive at the minimum bound", () => {
    expect(angleVerdict(137, 137, 147)).toBe(true);
  });

  it("is inclusive at the maximum bound", () => {
    expect(angleVerdict(147, 137, 147)).toBe(true);
  });

  it("is false just below the minimum", () => {
    expect(angleVerdict(136.9, 137, 147)).toBe(false);
  });

  it("is false just above the maximum", () => {
    expect(angleVerdict(147.1, 137, 147)).toBe(false);
  });

  // Documented-known display/pill contradiction — NOT a bug being fixed in this phase.
  // The results page computes the verdict from the raw value but renders the rounded one,
  // so a raw value just outside the band displays as a rounded value that reads as inside
  // it. Follow-up is tracked in test-plan.md §6.6 / §7 (pairs with S-05 rounding work).
  it("verdicts the raw value even when its rounded form would read as in-range (above max)", () => {
    expect(angleVerdict(147.4, 137, 147)).toBe(false);
    expect(formatAngle(147.4)).toBe(147); // page renders "147°" inside "137–147°"
  });

  it("verdicts the raw value even when its rounded form would read as in-range (below min)", () => {
    expect(angleVerdict(136.6, 137, 147)).toBe(false);
    expect(formatAngle(136.6)).toBe(137); // page renders "137°" inside "137–147°"
  });

  // The helper does not guard client-authored bounds — inverted bounds always fail.
  // Server-side validation of the posted shape is a later test-plan rollout phase.
  it("is always false when the bounds are inverted (min > max)", () => {
    expect(angleVerdict(140, 147, 137)).toBe(false);
    expect(angleVerdict(147, 147, 137)).toBe(false);
    expect(angleVerdict(137, 147, 137)).toBe(false);
  });
});
