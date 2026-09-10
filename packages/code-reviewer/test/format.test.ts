import { describe, expect, it } from "vitest";
import {
  decide,
  formatReviewMarkdown,
  formatReviewTerminal,
  type Review,
  type ReviewUsage,
} from "../src/index.js";

const review: Review = {
  summary: "One-line headline verdict.",
  assessment:
    "A holistic assessment paragraph covering architecture and overall merge risk.",
  criteria: {
    pr_clarity: { score: 8, rationale: "Clear title and body.", notes: [] },
    minimal_readable: {
      score: 7,
      rationale: "Small, focused diff.",
      notes: [],
    },
    tested: { score: 6, rationale: "Some paths untested.", notes: [] },
    input_safety: {
      score: 9,
      rationale: "Inputs validated with zod.",
      notes: [
        {
          file: "src/pages/api/thing.ts",
          line: 42,
          observation: "Body is parsed before use.",
          suggestion: null,
        },
      ],
    },
    secrets_authz: {
      score: 10,
      rationale: "No secrets touched.",
      notes: [],
    },
  },
};

const usageNoCost: ReviewUsage = {
  inputTokens: 1000,
  outputTokens: 200,
  totalTokens: 1200,
  cachedTokens: 0,
  reasoningTokens: 0,
  modelCalls: 1,
};

describe("formatReviewMarkdown", () => {
  it("emits a 5-row score table and a PASS header", () => {
    const md = formatReviewMarkdown(
      review,
      decide(review, 5),
      usageNoCost,
      "test/model",
    );
    expect(md).toContain("**AI code review — PASS**");
    const rows = md
      .split("\n")
      .filter((l) => l.startsWith("| ") && l.includes("/10"));
    expect(rows).toHaveLength(5);
  });

  it("renders a FAIL header carrying the min score and threshold", () => {
    const failing: Review = {
      ...review,
      criteria: {
        ...review.criteria,
        input_safety: { score: 2, rationale: "unsafe", notes: [] },
      },
    };
    const md = formatReviewMarkdown(
      failing,
      decide(failing, 5),
      usageNoCost,
      "test/model",
    );
    expect(md).toContain("FAIL (min 2 < fail-below 5)");
  });

  it("omits the cost entry from the footer when usage.cost is undefined", () => {
    const md = formatReviewMarkdown(
      review,
      decide(review, 5),
      usageNoCost,
      "test/model",
    );
    expect(md).not.toContain("$");

    const withCost = formatReviewMarkdown(
      review,
      decide(review, 5),
      { ...usageNoCost, cost: 0.0123 },
      "test/model",
    );
    expect(withCost).toContain("$0.0123");
  });
});

describe("formatReviewTerminal", () => {
  it("includes every criterion label and the footer model", () => {
    const text = formatReviewTerminal(
      review,
      decide(review, 5),
      usageNoCost,
      "test/model",
    );
    expect(text).toContain("Minimal, readable implementation");
    expect(text).toContain("test/model");
  });
});
