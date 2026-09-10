import { describe, expect, it, vi } from "vitest";
import {
  createReviewer,
  parseReview,
  reviewSchema,
  toJsonSchemaFormat,
  ReviewParseError,
  type Review,
  type ReviewerClient,
} from "../src/index.js";

const cannedReview: Review = {
  summary:
    "Adds a login endpoint with a SQL-injection sink and a hardcoded token.",
  assessment:
    "The change adds one endpoint but introduces two serious security defects: an interpolated SQL query and a hardcoded session token. There are no tests. Do not merge until the query is parameterized and the token is removed.",
  criteria: {
    pr_clarity: {
      score: 6,
      rationale: "Title states the change; no test instructions.",
      notes: [],
    },
    minimal_readable: {
      score: 7,
      rationale: "Small, focused diff.",
      notes: [],
    },
    tested: {
      score: 3,
      rationale: "No tests for the new endpoint.",
      notes: [],
    },
    input_safety: {
      score: 2,
      rationale: "SQL built by string interpolation.",
      notes: [
        {
          file: "src/pages/api/login.ts",
          line: 12,
          observation: "username is interpolated straight into the SQL string.",
          suggestion: "Use a parameterized query.",
        },
      ],
    },
    secrets_authz: {
      score: 2,
      rationale: "Session token is a hardcoded literal.",
      notes: [
        {
          file: "src/pages/api/login.ts",
          line: 20,
          observation: "The session token is a constant string.",
          suggestion: "Issue a signed token; read secrets from env.",
        },
      ],
    },
  },
};

const request = {
  prTitle: "Add login endpoint",
  prDescription: "Adds POST /api/login for username + password auth.",
  diff: [
    "diff --git a/src/pages/api/login.ts b/src/pages/api/login.ts",
    "+++ b/src/pages/api/login.ts",
    "+const rows = await db.query(`SELECT * FROM users WHERE name = '${username}'`);",
  ].join("\n"),
};

/** A fake OpenRouter client whose callModel returns a fixed response string. */
function fakeClient(responseText: string) {
  const callModel = vi.fn((_request: Record<string, unknown>) => ({
    getText: async () => responseText,
    getUsage: async () => ({
      modelCalls: 1,
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      cachedTokens: 0,
      reasoningTokens: 0,
    }),
  }));
  return { client: { callModel } as unknown as ReviewerClient, callModel };
}

describe("createReviewer", () => {
  it("makes one tool-less structured call and returns a validated review + usage", async () => {
    const { client, callModel } = fakeClient(JSON.stringify(cannedReview));
    const reviewer = createReviewer({ client, model: "test/model" });

    const { review, usage } = await reviewer.review(request);

    expect(callModel).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sent = callModel.mock.calls[0]![0] as any;
    expect(sent.model).toBe("test/model");
    expect(sent.input).toContain("Add login endpoint");
    expect(sent.input).toContain("SELECT * FROM users");
    expect(sent.tools).toBeUndefined();
    expect(sent.provider).toEqual({ requireParameters: true });
    expect(sent.maxOutputTokens).toBe(8000);
    expect(sent.text.format.type).toBe("json_schema");
    expect(sent.text.format.schema.$schema).toBeUndefined();

    expect(review.criteria.input_safety.score).toBe(2);
    expect(usage.modelCalls).toBe(1);
  });

  it("recovers a JSON review wrapped in markdown fences and prose", async () => {
    const wrapped = `Sure — here is the review:\n\n\`\`\`json\n${JSON.stringify(
      cannedReview,
    )}\n\`\`\`\n`;
    const { client } = fakeClient(wrapped);
    const reviewer = createReviewer({ client });

    const { review } = await reviewer.review(request);

    expect(review.criteria.secrets_authz.score).toBe(2);
  });

  it("throws ReviewParseError when the model output breaks the schema", async () => {
    const { client } = fakeClient(
      JSON.stringify({ summary: "ok", assessment: "ok", criteria: {} }),
    );
    const reviewer = createReviewer({ client });

    await expect(reviewer.review(request)).rejects.toBeInstanceOf(
      ReviewParseError,
    );
  });

  it("rejects an empty diff", async () => {
    const { client } = fakeClient("{}");
    const reviewer = createReviewer({ client });

    await expect(
      reviewer.review({ ...request, diff: "   \n  " }),
    ).rejects.toThrow(/diff/);
  });
});

describe("toJsonSchemaFormat", () => {
  it("produces an OpenRouter json_schema block from a zod schema", () => {
    const format = toJsonSchemaFormat(reviewSchema, "code_review", true);
    expect(format).toMatchObject({
      type: "json_schema",
      name: "code_review",
      strict: true,
    });
    expect(format.schema).toMatchObject({ type: "object" });
    expect(format.schema).not.toHaveProperty("$schema");
  });
});

describe("parseReview", () => {
  it("parses a clean JSON string", () => {
    expect(
      parseReview(JSON.stringify(cannedReview)).criteria.tested.score,
    ).toBe(3);
  });

  it("attaches the raw response to the error", () => {
    try {
      parseReview("not json at all");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ReviewParseError);
      expect((error as ReviewParseError).rawResponse).toBe("not json at all");
    }
  });
});

// Real end-to-end call. Opt in with: OPENROUTER_RUN_INTEGRATION=1 npm test
describe.skipIf(!process.env.OPENROUTER_RUN_INTEGRATION)("integration", () => {
  it("returns a schema-valid scored review of a real diff with low input_safety", async () => {
    const reviewer = createReviewer({
      model: process.env.CODE_REVIEWER_MODEL ?? "anthropic/claude-sonnet-4.5",
    });

    const { review } = await reviewer.review(request);

    expect(reviewSchema.parse(review)).toEqual(review);
    expect(review.criteria.input_safety.score).toBeLessThanOrEqual(4);
  });
});
