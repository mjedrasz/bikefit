import { describe, expect, it } from "vitest";
import {
  parseReview,
  reviewSchema,
  toJsonSchemaFormat,
  ReviewParseError,
  type Review,
} from "../src/index.js";

const validReview: Review = {
  summary: "Small, well-tested change with no security concerns.",
  assessment:
    "The change is scoped to one module and adds a parameterized query helper. Tests cover the happy path and one error path. No cross-cutting risk; safe to merge.",
  criteria: {
    pr_clarity: {
      score: 8,
      rationale: "Title and body are clear and state how to test.",
      notes: [],
    },
    minimal_readable: {
      score: 9,
      rationale: "Diff is minimal and matches the surrounding style.",
      notes: [],
    },
    tested: { score: 7, rationale: "New logic has unit tests.", notes: [] },
    input_safety: {
      score: 9,
      rationale: "Parameterized queries throughout.",
      notes: [],
    },
    secrets_authz: {
      score: 10,
      rationale: "No secrets or auth surface touched.",
      notes: [],
    },
  },
};

describe("reviewSchema", () => {
  it("parses a valid full review", () => {
    expect(parseReview(JSON.stringify(validReview))).toEqual(validReview);
  });

  it("rejects a review missing a criterion key", () => {
    const { secrets_authz: _dropped, ...rest } = validReview.criteria;
    const broken = { ...validReview, criteria: rest };
    expect(() => parseReview(JSON.stringify(broken))).toThrow(ReviewParseError);
  });

  it.each([0, 11])("rejects an out-of-range score (%i)", (score) => {
    const broken = {
      ...validReview,
      criteria: {
        ...validReview.criteria,
        input_safety: { score, rationale: "out of range", notes: [] },
      },
    };
    expect(() => parseReview(JSON.stringify(broken))).toThrow(ReviewParseError);
  });
});

describe("toJsonSchemaFormat", () => {
  it("emits a strict json_schema block with all five criteria required", () => {
    const format = toJsonSchemaFormat(reviewSchema, "code_review", true);

    expect(format.type).toBe("json_schema");
    expect(format.strict).toBe(true);

    const schema = format.schema as Record<string, unknown>;
    expect(schema["type"]).toBe("object");
    expect(schema).not.toHaveProperty("$schema");

    const criteria = (schema["properties"] as Record<string, unknown>)[
      "criteria"
    ] as Record<string, unknown>;
    expect(criteria["additionalProperties"]).toBe(false);
    expect(criteria["required"]).toEqual(
      expect.arrayContaining([
        "pr_clarity",
        "minimal_readable",
        "tested",
        "input_safety",
        "secrets_authz",
      ]),
    );
  });
});
