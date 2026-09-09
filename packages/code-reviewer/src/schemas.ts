import { z } from "zod";

/**
 * Zod schemas that define the contract between the reviewer agent and the rest
 * of the app. The same `reviewSchema` is:
 *   1. converted to JSON Schema and sent to the model as a `json_schema`
 *      response format (so the model is constrained to this shape), and
 *   2. used to validate + parse whatever the model returns.
 *
 * Every field is required (`.nullable()` instead of `.optional()`) so the schema
 * round-trips cleanly through OpenAI-style strict structured outputs.
 */

export const severitySchema = z.enum([
  "critical",
  "high",
  "medium",
  "low",
  "info",
]);
export type Severity = z.infer<typeof severitySchema>;

export const categorySchema = z.enum([
  "security",
  "correctness",
  "performance",
  "maintainability",
  "testing",
  "style",
  "other",
]);
export type Category = z.infer<typeof categorySchema>;

export const findingSchema = z.object({
  file: z
    .string()
    .describe(
      "Path of the file the finding is in, relative to the review root",
    ),
  line: z
    .number()
    .int()
    .positive()
    .nullable()
    .describe("1-indexed line the finding anchors to, or null if file-wide"),
  severity: severitySchema,
  category: categorySchema,
  title: z.string().min(1).describe("One-line summary of the issue"),
  description: z
    .string()
    .min(1)
    .describe("What is wrong, and why it matters, in 1-3 sentences"),
  suggestion: z
    .string()
    .nullable()
    .describe(
      "Concrete fix or mitigation, or null if there is nothing to suggest",
    ),
});
export type Finding = z.infer<typeof findingSchema>;

export const verdictSchema = z.enum(["approve", "comment", "request_changes"]);
export type Verdict = z.infer<typeof verdictSchema>;

export const reviewSchema = z.object({
  summary: z
    .string()
    .min(1)
    .describe("2-4 sentence overall assessment of the change"),
  verdict: verdictSchema.describe(
    "approve = ship it, comment = non-blocking notes, request_changes = must fix before merge",
  ),
  findings: z
    .array(findingSchema)
    .describe("Specific issues found. Empty array when the code looks good."),
});
export type Review = z.infer<typeof reviewSchema>;
