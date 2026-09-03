import { z } from "zod";

// Pure, I/O-free helpers for parsing an OpenRouter `message.content` payload. Kept out of
// `src/lib/services/llm.ts` (which imports `astro:env/server`) so the branches are directly
// unit-testable and inside StrykerJS's `mutate` scope — see `stryker.config.json` and
// test-plan §6.3.

/**
 * Strip a Markdown code fence around a JSON body. Models frequently wrap structured output
 * in ```` ```json … ``` ```` despite an explicit "no markdown" instruction; that body dies
 * in `JSON.parse` today.
 *
 * Removes a leading ```` ``` ```` / ```` ```json ```` line and a trailing ```` ``` ````,
 * then trims. Returns the input **unchanged** when there is no leading fence. A body that is
 * *only* a fence collapses to `""`, so the caller's `JSON.parse` still throws its
 * "invalid JSON" error.
 */
export function stripJsonFence(input: string): string {
  const trimmed = input.trim();
  if (!trimmed.startsWith("```")) return input;
  return trimmed
    .replace(/^```[^\n]*\r?\n?/, "") // opening ``` or ```json line
    .replace(/\r?\n?```$/, "") // closing ```
    .trim();
}

/**
 * One keyframe from the vision model. `f` (frame number) is required in the request schema
 * (`ANALYZE_VIDEO_SYSTEM_PROMPT`) but dropped from `analyzeVideo`'s return type, so it is
 * accepted-but-optional here rather than a rejection cause.
 */
export const timestampItemSchema = z.object({
  t: z.number(),
  f: z.number().optional(),
  type: z.enum(["BDC", "TDC"]),
});

export const timestampListSchema = z.array(timestampItemSchema);
