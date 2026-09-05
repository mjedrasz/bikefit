import { z } from "zod";

export const createSessionSchema = z.object({
  video_filename: z.string().min(1),
  video_duration_s: z.number().positive(),
});

export const recommendationSchema = z.object({
  adjustment: z.string(),
  rationale: z.string(),
});

export const bodyAngleSchema = z.object({
  name: z.string().max(200),
  value: z.number(),
  reference_min: z.number(),
  reference_max: z.number(),
  unit: z.string().max(200),
});

export const analyzeRequestSchema = z.object({
  video: z.string().min(1).max(140_000_000),
  session_id: z.uuid(),
});

export const recommendRequestSchema = z.object({
  body_angles: z.array(bodyAngleSchema).min(1).max(20),
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
