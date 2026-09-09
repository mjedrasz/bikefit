import { OpenRouter, stepCountIs } from "@openrouter/agent";
import { z } from "zod";
import { reviewSchema, type Review } from "./schemas.js";
import { createFileTools } from "./tools.js";

/**
 * Minimal surface of the OpenRouter client the reviewer needs. Declaring it here
 * (rather than depending on the concrete class everywhere) keeps `createReviewer`
 * trivially mockable in tests.
 */
export interface ReviewerClient {
  callModel: OpenRouter["callModel"];
}

export interface ReviewerOptions {
  /** Inject a client (tests, custom base URL, ...). Defaults to a real OpenRouter client. */
  client?: ReviewerClient;
  /** OpenRouter API key. Defaults to `process.env.OPENROUTER_API_KEY`. */
  apiKey?: string;
  /** Model slug. Defaults to `$CODE_REVIEWER_MODEL` or `anthropic/claude-sonnet-4.5`. */
  model?: string;
  /** Max agent steps (tool round-trips) before the model is forced to answer. */
  maxSteps?: number;
  /** Constrain the model output to the JSON schema strictly. Default `true`. */
  strict?: boolean;
}

export interface ReviewRequest {
  /** Directory the agent is allowed to read from. */
  rootDir: string;
  /** Files to review, relative to `rootDir`. */
  files: string[];
  /** Optional extra context: a unified diff, PR description, ticket text, ... */
  context?: string;
}

const DEFAULT_MODEL =
  process.env.CODE_REVIEWER_MODEL ?? "anthropic/claude-sonnet-4.5";

const INSTRUCTIONS = `You are a meticulous senior software engineer doing a focused code review.

Process:
- Use "read_file" to read every file under review. Use "list_files" and "read_file" to pull in
  neighbouring modules, callers, types and tests whenever you need context.
- Look for real defects: security holes, injection, auth/authorization gaps, secret leakage,
  correctness bugs, race conditions, unhandled errors, resource leaks, performance traps,
  and clear maintainability problems.
- Report a small number of high-signal findings. Do not pad the list with subjective style nits.
- Never invent problems. If the code is solid, return an "approve" verdict and an empty findings array.
- Each finding must name a concrete file, a line number where possible, the concrete impact,
  and an actionable suggestion.

When your investigation is complete, output ONLY the final JSON review object. No prose, no code fences.`;

/** Turn a Zod schema into an OpenRouter `json_schema` response-format block. */
export function toJsonSchemaFormat(
  schema: z.ZodType,
  name: string,
  strict: boolean,
) {
  const jsonSchema = z.toJSONSchema(schema, {
    target: "draft-2020-12",
  }) as Record<string, unknown>;
  delete jsonSchema["$schema"];
  return { type: "json_schema" as const, name, strict, schema: jsonSchema };
}

export class ReviewParseError extends Error {
  readonly rawResponse: string;

  constructor(rawResponse: string, cause: unknown) {
    super(
      `Reviewer response did not match the expected schema: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { cause },
    );
    this.name = "ReviewParseError";
    this.rawResponse = rawResponse;
  }
}

/** Pull the JSON review object out of a model response and validate it. */
export function parseReview(text: string): Review {
  let candidate: unknown;
  try {
    candidate = extractJson(text);
  } catch (error) {
    throw new ReviewParseError(text, error);
  }

  const result = reviewSchema.safeParse(candidate);
  if (!result.success) {
    throw new ReviewParseError(text, result.error);
  }
  return result.data;
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text).trim();

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new SyntaxError("no JSON object found in response");
  }
}

export function createReviewer(options: ReviewerOptions = {}) {
  const model = options.model ?? DEFAULT_MODEL;
  const maxSteps = options.maxSteps ?? 12;
  const strict = options.strict ?? true;

  const client: ReviewerClient =
    options.client ??
    new OpenRouter({
      apiKey: options.apiKey ?? process.env.OPENROUTER_API_KEY,
    });

  async function review(request: ReviewRequest): Promise<Review> {
    if (request.files.length === 0) {
      throw new Error("review() needs at least one file");
    }

    const tools = createFileTools(request.rootDir);

    const prompt = [
      "Review the following file(s), relative to the review root:",
      ...request.files.map((file) => `- ${file}`),
    ];
    if (request.context?.trim()) {
      prompt.push("", "Additional context:", request.context.trim());
    }

    const run = client.callModel({
      model,
      instructions: INSTRUCTIONS,
      input: prompt.join("\n"),
      tools,
      stopWhen: stepCountIs(maxSteps),
      text: { format: toJsonSchemaFormat(reviewSchema, "code_review", strict) },
    });

    return parseReview(await run.getText());
  }

  return { review, model };
}
