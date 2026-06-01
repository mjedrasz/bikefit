import { z } from "zod";

export const recommendationSchema = z.object({
  adjustment: z.string(),
  rationale: z.string(),
});

export const bodyAngleSchema = z.object({
  name: z.string(),
  value: z.number(),
  reference_min: z.number(),
  reference_max: z.number(),
  unit: z.string(),
});

export const resultsPayloadSchema = z.discriminatedUnion("error", [
  z.object({
    error: z.literal(false).optional(),
    recommendations: z.array(recommendationSchema),
    body_angles: z.array(bodyAngleSchema),
    raw_llm_response: z.string().optional(),
  }),
  z.object({
    error: z.literal(true),
    error_message: z.string(),
  }),
]);
