import { describe, it, expect } from "vitest";
import { formatAngle } from "@/lib/format-angle";

// Smoke spec for the Vitest harness: proves the runner resolves the `@/*` alias, TypeScript,
// and Astro's Vite plugin chain before any real test depends on it. Also the permanent unit
// test for `formatAngle` (display-only rounding to the nearest whole degree).
describe("formatAngle", () => {
  it("rounds down below .5", () => {
    expect(formatAngle(147.4)).toBe(147);
  });

  it("rounds up at .5 and above", () => {
    expect(formatAngle(136.6)).toBe(137);
  });
});
