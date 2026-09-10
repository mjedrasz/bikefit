import {
  OpenRouter,
  maxCost,
  maxTokensUsed,
  type SessionUsageTotals,
} from "@openrouter/agent";
import { z } from "zod";
import { reviewSchema, type Review } from "./schemas.js";

/**
 * Minimal surface of the OpenRouter client the reviewer needs. Declaring it here
 * (rather than depending on the concrete class everywhere) keeps `createReviewer`
 * trivially mockable in tests.
 */
export interface ReviewerClient {
  callModel: OpenRouter["callModel"];
}

/**
 * Aggregate token / cost usage for one review. Re-exported under a local name so
 * `index.ts` does not leak the SDK type name.
 */
export type ReviewUsage = SessionUsageTotals;

export interface ReviewerOptions {
  /** Inject a client (tests, custom base URL, ...). Defaults to a real OpenRouter client. */
  client?: ReviewerClient;
  /** OpenRouter API key. Defaults to `process.env.OPENROUTER_API_KEY`. */
  apiKey?: string;
  /** Model slug. Defaults to `$CODE_REVIEWER_MODEL` or `anthropic/claude-sonnet-4.5`. */
  model?: string;
  /** Constrain the model output to the JSON schema strictly. Default `true`. */
  strict?: boolean;
  /** Generation ceiling for the single model call. Default `8_000`. */
  maxOutputTokens?: number;
  /** Wall-clock deadline for the call, in milliseconds. Default `300_000`. */
  timeoutMs?: number;
  /**
   * Passed to `stopWhen`, but **inert for this single-call design**: `stopWhen`
   * conditions are evaluated between agent steps, and with no tools the one
   * generation completes before they are ever checked. Kept only as
   * future-proofing for a later tools variant. Default `0.5`.
   */
  maxCostUsd?: number;
  /** Passed to `stopWhen`; inert for this single-call design (see `maxCostUsd`). Default `200_000`. */
  maxTokens?: number;
}

export interface ReviewRequest {
  /** PR title — drives the `pr_clarity` criterion. */
  prTitle: string;
  /** PR description / body. */
  prDescription: string;
  /** Unified diff of the change under review. */
  diff: string;
}

export interface ReviewResult {
  review: Review;
  usage: ReviewUsage;
}

const DEFAULT_MODEL =
  process.env.CODE_REVIEWER_MODEL ?? "anthropic/claude-sonnet-4.5";

const INSTRUCTIONS = `You are a meticulous senior software engineer reviewing a single pull request.

You are given the PR title, the PR description, and the unified diff. You see only
what is in this prompt — there is no repository to browse.

Score the change against these five criteria, each on a 1-10 scale where 1 is the
worst outcome and 10 is the best:

1. pr_clarity — Clear PR title & description. Title states the change; description
   covers what, why, and how to test. Linked issue.
2. minimal_readable — Minimal, readable implementation. Solves the stated problem,
   no speculative abstraction or unrelated changes, diff is as small as it can be.
   Names say what things are; matches surrounding style; no dead code, stray logs,
   or commented-out blocks.
3. tested — Tested. New logic has tests; changed behavior updates existing ones.
   Edge cases and error paths covered.
4. input_safety — Input validated at boundaries & no unsafe sinks. API bodies,
   params, and env vars parsed with zod before use; never cast raw JSON to a type.
   Parameterized queries only; no unsanitized HTML (set:html,
   dangerouslySetInnerHTML); no user input in shell or redirects.
5. secrets_authz — Secrets & authorization. Keys/tokens from env only; nothing
   sensitive logged or committed. Every protected route/query checks the current
   user; RLS policies present on new tables.

Rules:
- Score every criterion even if the diff does not obviously touch it — a criterion
  with nothing to flag scores high.
- Each note names a concrete file and, where possible, a line from the diff.
- "assessment" is a holistic 3-6 sentence take on the whole change:
  architecture-level and cross-cutting observations, and the overall risk of
  merging. It is not scoped to any one criterion.
- Output ONLY the final JSON review object. No prose, no code fences.`;

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
  const strict = options.strict ?? true;
  const maxOutputTokens = options.maxOutputTokens ?? 8_000;
  const timeoutMs = options.timeoutMs ?? 300_000;
  const maxCostUsd = options.maxCostUsd ?? 0.5;
  const maxTokens = options.maxTokens ?? 200_000;

  const client: ReviewerClient =
    options.client ??
    new OpenRouter({
      apiKey: options.apiKey ?? process.env.OPENROUTER_API_KEY,
      // A CI gate must be bounded. The SDK default retries 5XX and connection
      // failures with exponential backoff for up to an hour, and
      // `retryConnectionErrors: true` classifies our `AbortSignal.timeout`
      // firing as a retryable timeout — so `signal` alone cannot bound the
      // call. Disable retry: one dispatch, bounded by `signal`; a transient
      // upstream error surfaces as `decision: "error"` (fail-open on infra).
      retryConfig: { strategy: "none" },
    });

  async function review(request: ReviewRequest): Promise<ReviewResult> {
    if (request.diff.trim() === "") {
      throw new Error("review() needs a non-empty diff");
    }

    const prompt = [
      "## PR title",
      request.prTitle.trim() || "_(none provided)_",
      "",
      "## PR description",
      request.prDescription.trim() || "_(none provided)_",
      "",
      "## Diff",
      "```diff",
      request.diff,
      "```",
    ].join("\n");

    const run = client.callModel({
      model,
      instructions: INSTRUCTIONS,
      input: prompt,
      maxOutputTokens,
      provider: { requireParameters: true },
      stopWhen: [maxCost(maxCostUsd), maxTokensUsed(maxTokens)],
      text: {
        format: toJsonSchemaFormat(reviewSchema, "code_review", strict),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    const parsed = parseReview(await run.getText());
    const usage = await run.getUsage();
    return { review: parsed, usage };
  }

  return { review, model };
}
