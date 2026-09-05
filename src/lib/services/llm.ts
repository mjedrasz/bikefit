import { OPENROUTER_API_KEY } from "astro:env/server";
import { z } from "zod";
import type { BodyAngle, Recommendation } from "@/types";
import { buildRecommendationsSystemPrompt } from "@/lib/recommendations-prompt";
import { recommendationSchema } from "@/lib/schemas";
import { stripJsonFence, timestampListSchema } from "@/lib/llm-response";

const VISION_MODEL = "google/gemini-3.5-flash";
const TEXT_MODEL = "google/gemini-2.5-flash";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Every thrown message below is a FIXED string — no interpolation of upstream error text or
// the model's `content`. A direct API caller must never see OpenRouter's body or the raw
// (possibly huge / sensitive) completion. Detail that helps debugging is `console.error`-d
// server-side (Cloudflare observability) instead. See test-plan §6.3, Risk #2.

const ANALYZE_VIDEO_SYSTEM_PROMPT = `You are analyzing a cycling video. Identify keyframes where the pedal is at Bottom Dead Center (BDC, 6 o'clock) and Top Dead Center (TDC, 12 o'clock).
Respond with this exact format:
{
  "timestamps": [
    { "t": <second_of_the_frame>, "f": <frame_number>, "type": "BDC" | "TDC" }
  ]
}

Be as precise as possible with the timestamps (milliseconds precision if possible).
If you are unsure, do not guess, just respond with an empty array:
{
  "timestamps": []
}`;

interface OpenRouterEnvelope {
  choices?: { message?: { content?: string } }[];
}

async function readEnvelope(response: Response, subject: string): Promise<OpenRouterEnvelope> {
  try {
    return (await response.json()) as OpenRouterEnvelope;
  } catch {
    throw new Error(`OpenRouter returned a non-JSON response for ${subject} request`);
  }
}

export async function analyzeVideo(videoBase64: string): Promise<{ timestamps: { t: number; type: "BDC" | "TDC" }[] }> {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [
        {
          role: "system",
          content: ANALYZE_VIDEO_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Analyse the video for BDC and TDC timestamps.",
            },
            {
              type: "video_url",
              video_url: { url: `data:video/mp4;base64,${videoBase64}` },
            },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "body_angles",
          strict: true,
          schema: {
            type: "object",
            properties: {
              timestamps: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    t: { type: "number", description: "Second of the frame" },
                    f: { type: "number", description: "Frame number" },
                    type: { type: "string", description: "Type of timestamp (TDC or BDC)", enum: ["BDC", "TDC"] },
                  },
                  required: ["t", "f", "type"],
                  additionalProperties: false,
                },
              },
            },
            required: ["timestamps"],
            additionalProperties: false,
          },
        },
      },
    }),
  });

  if (!response.ok) {
    // eslint-disable-next-line no-console -- server-side detail for a fixed-string throw
    console.error("OpenRouter vision request failed", response.status, await response.text());
    throw new Error("OpenRouter vision request failed");
  }

  const data = await readEnvelope(response, "vision");
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenRouter returned no content for vision request");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(content));
  } catch {
    throw new Error("Vision LLM returned invalid JSON");
  }

  const result = timestampListSchema.safeParse((parsed as { timestamps?: unknown }).timestamps);
  if (!result.success) {
    throw new Error("Vision LLM returned a malformed timestamp list");
  }

  return { timestamps: result.data };
}

export async function generateRecommendations(
  angles: BodyAngle[],
): Promise<{ recommendations: Recommendation[]; raw_llm_response: string }> {
  const anglesText = angles
    .map(
      (a) => `- ${a.name}: ${a.value.toFixed(1)}${a.unit} (reference: ${a.reference_min}–${a.reference_max}${a.unit})`,
    )
    .join("\n");

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: TEXT_MODEL,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: buildRecommendationsSystemPrompt(),
        },
        {
          role: "user",
          content: `Here are the measured body angles for this gravel bike fitting session:\n\n${anglesText}\n\nPlease analyze these angles and provide fitting recommendations.`,
        },
      ],
    }),
  });

  if (!response.ok) {
    // eslint-disable-next-line no-console -- server-side detail for a fixed-string throw
    console.error("OpenRouter text request failed", response.status, await response.text());
    throw new Error("OpenRouter text request failed");
  }

  const data = await readEnvelope(response, "recommendations");
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenRouter returned no content for recommendations request");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(content));
  } catch {
    throw new Error("Recommendations LLM returned invalid JSON");
  }

  const result = parsed as { recommendations?: unknown; raw_llm_response?: unknown };
  const recsResult = z.array(recommendationSchema).safeParse(result.recommendations);
  if (!recsResult.success) {
    throw new Error("Recommendations LLM returned a malformed recommendation list");
  }
  if (typeof result.raw_llm_response !== "string") {
    throw new Error("Recommendations LLM response missing raw_llm_response string");
  }

  return {
    recommendations: recsResult.data,
    raw_llm_response: result.raw_llm_response,
  };
}
