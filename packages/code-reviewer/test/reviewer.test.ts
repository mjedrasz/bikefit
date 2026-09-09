import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  createFileReader,
  createReviewer,
  parseReview,
  reviewSchema,
  toJsonSchemaFormat,
  ReviewParseError,
  type Review,
  type ReviewerClient,
} from "../src/index.js";

const fixturesDir = fileURLToPath(new URL("./fixtures", import.meta.url));

const cannedReview: Review = {
  summary:
    "login() builds SQL by string interpolation and compares passwords in plaintext. Both must be fixed before merge.",
  verdict: "request_changes",
  findings: [
    {
      file: "insecure-login.ts",
      line: 10,
      severity: "critical",
      category: "security",
      title: "SQL injection via string interpolation",
      description:
        "username and password are concatenated straight into the query, so any caller can inject SQL.",
      suggestion:
        "Use parameterised queries (db.query(sql, [username, password])).",
    },
    {
      file: "insecure-login.ts",
      line: 15,
      severity: "high",
      category: "security",
      title: "Plaintext password comparison",
      description: "Passwords are stored and compared without hashing.",
      suggestion: "Hash with argon2/bcrypt and compare digests.",
    },
  ],
};

/** A fake OpenRouter client whose callModel returns a fixed response string. */
function fakeClient(responseText: string) {
  const callModel = vi.fn((_request: Record<string, unknown>) => ({
    getText: async () => responseText,
    getResponse: async () => ({ output: [], usage: {} }),
  }));
  return { client: { callModel } as unknown as ReviewerClient, callModel };
}

describe("createReviewer", () => {
  it("runs the agent flow and returns a schema-validated review", async () => {
    const { client, callModel } = fakeClient(JSON.stringify(cannedReview));
    const reviewer = createReviewer({ client, model: "test/model" });

    const review = await reviewer.review({
      rootDir: fixturesDir,
      files: ["insecure-login.ts"],
      context: "PR #123: new auth endpoint",
    });

    expect(callModel).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const request = callModel.mock.calls[0]![0] as any;
    expect(request.model).toBe("test/model");
    expect(request.instructions).toContain("code review");
    expect(request.input).toContain("insecure-login.ts");
    expect(request.input).toContain("PR #123");
    expect(request.tools).toHaveLength(2);
    expect(request.stopWhen).toBeDefined();
    expect(request.text.format.type).toBe("json_schema");
    expect(request.text.format.schema.type).toBe("object");
    expect(request.text.format.schema.$schema).toBeUndefined();

    expect(review.verdict).toBe("request_changes");
    expect(review.findings).toHaveLength(2);
    expect(review.findings[0]!.severity).toBe("critical");
  });

  it("recovers a JSON review wrapped in markdown fences and prose", async () => {
    const wrapped = `Sure — here is my review:\n\n\`\`\`json\n${JSON.stringify(
      cannedReview,
    )}\n\`\`\`\n`;
    const { client } = fakeClient(wrapped);
    const reviewer = createReviewer({ client });

    const review = await reviewer.review({
      rootDir: fixturesDir,
      files: ["insecure-login.ts"],
    });

    expect(review.findings).toHaveLength(2);
  });

  it("throws ReviewParseError when the model output breaks the schema", async () => {
    const { client } = fakeClient(
      JSON.stringify({ summary: "ok", verdict: "lgtm", findings: [] }),
    );
    const reviewer = createReviewer({ client });

    await expect(
      reviewer.review({ rootDir: fixturesDir, files: ["insecure-login.ts"] }),
    ).rejects.toBeInstanceOf(ReviewParseError);
  });

  it("rejects an empty file list", async () => {
    const { client } = fakeClient("{}");
    const reviewer = createReviewer({ client });
    await expect(
      reviewer.review({ rootDir: fixturesDir, files: [] }),
    ).rejects.toThrow(/at least one file/);
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
    expect(parseReview(JSON.stringify(cannedReview)).findings).toHaveLength(2);
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

describe("createFileReader", () => {
  it("reads files inside the root with line numbers", async () => {
    const files = createFileReader(fixturesDir);
    const { content } = await files.readFile("insecure-login.ts");
    expect(content).toContain("SELECT id, name, password FROM users");
    expect(content).toMatch(/^1\t/);
  });

  it("lists files under the root", async () => {
    const files = createFileReader(fixturesDir);
    expect(await files.listFiles()).toEqual(
      expect.arrayContaining(["db.ts", "insecure-login.ts"]),
    );
  });

  it("blocks path traversal outside the root", async () => {
    const files = createFileReader(fixturesDir);
    await expect(files.readFile("../../package.json")).rejects.toThrow(
      /escapes/,
    );
  });
});

// Real end-to-end call. Opt in with: OPENROUTER_RUN_INTEGRATION=1 npm test
describe.skipIf(!process.env.OPENROUTER_RUN_INTEGRATION)("integration", () => {
  it("finds the planted SQL-injection bug via a real model call", async () => {
    const reviewer = createReviewer({
      model: process.env.CODE_REVIEWER_MODEL ?? "anthropic/claude-sonnet-4.5",
    });

    const review = await reviewer.review({
      rootDir: fixturesDir,
      files: ["insecure-login.ts"],
    });

    expect(reviewSchema.parse(review)).toEqual(review);
    expect(review.verdict).toBe("request_changes");
    expect(
      review.findings.some(
        (f) =>
          f.category === "security" && /inject/i.test(f.title + f.description),
      ),
    ).toBe(true);
  });
});
