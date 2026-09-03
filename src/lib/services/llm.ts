import { OPENROUTER_API_KEY } from "astro:env/server";
import type { BodyAngle, Recommendation } from "@/types";
import { buildRecommendationsSystemPrompt } from "@/lib/recommendations-prompt";

const VISION_MODEL = "google/gemini-3.5-flash";
const TEXT_MODEL = "google/gemini-2.5-flash";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

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
    throw new Error(`OpenRouter vision request failed: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenRouter returned no content for vision request");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Vision LLM returned invalid JSON: ${content}`);
  }

  const result = parsed as { timestamps?: unknown };
  if (!Array.isArray(result.timestamps)) {
    throw new Error(`Vision LLM response missing timestamps array: ${content}`);
  }

  return { timestamps: result.timestamps as { t: number; type: "BDC" | "TDC" }[] };
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
    throw new Error(`OpenRouter text request failed: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenRouter returned no content for recommendations request");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Recommendations LLM returned invalid JSON: ${content}`);
  }

  const result = parsed as { recommendations?: unknown; raw_llm_response?: unknown };
  if (!Array.isArray(result.recommendations)) {
    throw new Error(`Recommendations LLM response missing recommendations array: ${content}`);
  }
  if (typeof result.raw_llm_response !== "string") {
    throw new Error(`Recommendations LLM response missing raw_llm_response string: ${content}`);
  }

  return {
    recommendations: result.recommendations as Recommendation[],
    raw_llm_response: result.raw_llm_response,
  };
}
