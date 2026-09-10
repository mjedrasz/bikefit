import { z } from "zod";

/**
 * Zod schemas that define the contract between the reviewer and the rest of the
 * tooling. The same `reviewSchema` is:
 *   1. converted to JSON Schema and sent to the model as a `json_schema`
 *      response format (so the model is constrained to this shape), and
 *   2. used to validate + parse whatever the model returns.
 *
 * Every field is required (`.nullable()` instead of `.optional()`) so the schema
 * round-trips cleanly through OpenAI-style strict structured outputs, which
 * forbid optional keys. The provider ignores `minimum` / `maximum` under
 * emulated strict mode, so `reviewSchema.parse()` is the *only* runtime
 * enforcement of the score range — the bounds must stay on the schema for
 * `parse()` to reject a `score` of 0 or 11.
 */

/** The five scored criteria, in canonical order. */
export const CRITERION_IDS = [
  "pr_clarity",
  "minimal_readable",
  "tested",
  "input_safety",
  "secrets_authz",
] as const;

export type CriterionId = (typeof CRITERION_IDS)[number];

/** Human-readable label for each criterion, for the score table. */
export const CRITERION_LABELS: Record<CriterionId, string> = {
  pr_clarity: "Clear PR title & description",
  minimal_readable: "Minimal, readable implementation",
  tested: "Tested",
  input_safety: "Input validated at boundaries & no unsafe sinks",
  secrets_authz: "Secrets & authorization",
};

/** Which group each criterion belongs to. */
export const CRITERION_GROUPS: Record<CriterionId, "general" | "security"> = {
  pr_clarity: "general",
  minimal_readable: "general",
  tested: "general",
  input_safety: "security",
  secrets_authz: "security",
};

export const criterionNoteSchema = z.object({
  file: z
    .string()
    .describe(
      'Path of the file this note is about, relative to the repo root, or "" when the note is not file-specific',
    ),
  line: z
    .number()
    .int()
    .positive()
    .nullable()
    .describe("1-indexed line from the diff this note anchors to, or null"),
  observation: z
    .string()
    .min(1)
    .describe("What was observed, in 1-2 sentences"),
  suggestion: z
    .string()
    .nullable()
    .describe(
      "Concrete fix or improvement, or null when there is nothing to suggest",
    ),
});
export type CriterionNote = z.infer<typeof criterionNoteSchema>;

export const criterionScoreSchema = z.object({
  score: z
    .number()
    .int()
    .min(1)
    .max(10)
    .describe(
      "1-10, 1 = worst, 10 = best. Score every criterion even if the diff does not obviously touch it — a criterion with nothing to flag scores high.",
    ),
  rationale: z
    .string()
    .min(1)
    .describe("One or two sentences explaining the score"),
  notes: z
    .array(criterionNoteSchema)
    .describe(
      "Concrete observations for this criterion; may be empty when there is nothing to flag",
    ),
});
export type CriterionScore = z.infer<typeof criterionScoreSchema>;

export const reviewSchema = z.object({
  summary: z
    .string()
    .min(1)
    .describe("One-sentence overall conclusion about the change"),
  assessment: z
    .string()
    .min(1)
    .describe(
      "3-6 sentence general assessment: architecture-level and cross-cutting observations and the overall risk of merging. Holistic — not scoped to any single criterion.",
    ),
  criteria: z.object({
    pr_clarity: criterionScoreSchema,
    minimal_readable: criterionScoreSchema,
    tested: criterionScoreSchema,
    input_safety: criterionScoreSchema,
    secrets_authz: criterionScoreSchema,
  }),
});
export type Review = z.infer<typeof reviewSchema>;
