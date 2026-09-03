import { describe, it, expect } from "vitest";
import { buildRecommendationsSystemPrompt } from "@/lib/recommendations-prompt";
import { ANGLE_REFS } from "@/lib/pose/angles";

// Guards the generated recommendations system prompt against band drift and against the
// retired pre-resolution numbers creeping back in. The prompt is a pure function of
// ANGLE_REFS, which is itself pinned to `context/foundation/reference-angles.md` by
// `src/lib/pose/angles.test.ts` — so every assertion here traces back to that doc.
//
// Pure imports only: importing `src/lib/services/llm.ts` would transitively pull in
// `astro:env/server` and throw at import time (test-plan §6.6).

describe("buildRecommendationsSystemPrompt", () => {
  const prompt = buildRecommendationsSystemPrompt(ANGLE_REFS);

  it("renders every blessed band from ANGLE_REFS — name, min–max range, measured-at", () => {
    for (const ref of Object.values(ANGLE_REFS)) {
      expect(prompt).toContain(ref.name);
      expect(prompt).toContain(`${ref.min}–${ref.max}°`);
      expect(prompt).toContain(ref.measuredAt);
    }
  });

  it("renders each convention qualifier uniformly in the name cell", () => {
    // Every non-torso row carries "(included)"; the torso row's qualifier moved out of the
    // range cell into the name cell (the one deliberate wording change this phase).
    expect(prompt).toContain("(included)");
    expect(prompt).toContain("Torso angle (from horizontal)");
  });

  it("contains none of the retired pre-resolution band numbers", () => {
    for (const retired of ["137–147", "65–75", "55–65", "150–160"]) {
      expect(prompt).not.toContain(retired);
    }
  });

  it("per-angle adjustment rules name a direction relative to the range, not a degree threshold", () => {
    const section = prompt.split("## Per-angle adjustment rules")[1].split("\n## ")[0];
    expect(section).not.toMatch(/[<>]\s*\d+\s*°/);
  });
});
