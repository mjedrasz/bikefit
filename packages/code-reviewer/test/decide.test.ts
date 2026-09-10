import { describe, expect, it } from "vitest";
import { decide, type CriterionId, type Review } from "../src/index.js";

function reviewWith(scores: Partial<Record<CriterionId, number>>): Review {
  const mk = (score: number) => ({ score, rationale: "r", notes: [] });
  return {
    summary: "s",
    assessment: "a",
    criteria: {
      pr_clarity: mk(scores.pr_clarity ?? 8),
      minimal_readable: mk(scores.minimal_readable ?? 8),
      tested: mk(scores.tested ?? 8),
      input_safety: mk(scores.input_safety ?? 8),
      secrets_authz: mk(scores.secrets_authz ?? 8),
    },
  };
}

describe("decide", () => {
  it("passes when every score equals failBelow (boundary is <, not <=)", () => {
    const d = decide(
      reviewWith({
        pr_clarity: 5,
        minimal_readable: 5,
        tested: 5,
        input_safety: 5,
        secrets_authz: 5,
      }),
      5,
    );
    expect(d.decision).toBe("pass");
    expect(d.minScore).toBe(5);
    expect(d.failing).toEqual([]);
  });

  it("fails when one score is failBelow - 1", () => {
    const d = decide(reviewWith({ input_safety: 4 }), 5);
    expect(d.decision).toBe("fail");
    expect(d.failing).toEqual(["input_safety"]);
    expect(d.minScore).toBe(4);
  });

  it("reports failing criteria in CRITERION_IDS order with the right minScore", () => {
    const d = decide(reviewWith({ secrets_authz: 2, pr_clarity: 3 }), 5);
    expect(d.failing).toEqual(["pr_clarity", "secrets_authz"]);
    expect(d.minScore).toBe(2);
    expect(d.failBelow).toBe(5);
  });
});
