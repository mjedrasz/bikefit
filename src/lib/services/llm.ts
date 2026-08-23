import { OPENROUTER_API_KEY } from "astro:env/server";
import type { BodyAngle, Recommendation } from "@/types";

const VISION_MODEL = "google/gemini-3.5-flash";
const TEXT_MODEL = "google/gemini-2.5-flash";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const RECOMMENDATIONS_SYSTEM_PROMPT = `You are a certified bike fitter specializing in gravel bikes for recreational cyclists.

## Reference angle ranges (gravel, recreational)

| Angle | Reference range | Measured at |
|---|---|---|
| Knee angle at BDC (included) | 137–147° | Bottom of pedal stroke (6 o'clock) |
| Knee angle at TDC (included) | 65–75° | Top of pedal stroke (12 o'clock) |
| Hip angle at TDC (included) | 55–65° | Top of pedal stroke (12 o'clock) |
| Torso angle | 45–55° from horizontal | Hands on hoods, cranks horizontal |
| Elbow angle (included) | 150–160° | Riding on hoods |

## Order of adjustments (always follow this sequence)

1. Saddle height → fixes knee angle at BDC (1 mm saddle ≈ 1° knee angle change)
2. Saddle fore/aft → fixes hip angle at TDC (work in 3–5 mm increments)
3. Bar height (spacers / stem angle) → fixes torso angle (5 mm spacer ≈ 1–2° torso angle)
4. Stem length → fixes elbow/reach angle (10 mm stem ≈ 5–10° elbow angle change)

## Per-angle adjustment rules

- **Knee BDC too low (<137°)**: raise saddle ~1 mm per degree needed; never move >10 mm per session
- **Knee BDC too high (>147°)**: lower saddle ~1 mm per degree needed
- **Knee TDC out of range**: driven by the same saddle height as BDC; trust TDC signal in ambiguous cases
- **Hip too closed (<55°)**: move saddle forward 3–5 mm; recheck knee BDC after
- **Hip too open (>65°)**: move saddle backward 3–5 mm; recheck knee BDC after
- **Torso too flat (<45°)**: add spacers or flip stem upward; 5 mm spacer ≈ 1–2°
- **Torso too upright (>55°)**: remove spacers or use negative-rise stem
- **Elbow over-extended (<150°)**: shorten stem by 10 mm increments
- **Elbow too bent (>160°)**: lengthen stem by 10 mm increments

## Coupling effects (always re-check after each change)

- Saddle height ±5 mm → recheck hip angle at TDC
- Saddle fore/aft ±5 mm → recheck knee angle at BDC (effective height changes)
- Bar height ±10 mm → recheck elbow angle (reach changes slightly)
- Stem length ±10 mm → recheck torso angle (height changes slightly)

## Output instructions

Return ONLY a valid JSON object (no markdown, no extra text) in this exact format:
{
  "recommendations": [
    { "adjustment": "concise action to take", "rationale": "why, referencing the measured angle and target range" }
  ],
  "raw_llm_response": "your reasoning and analysis here - be concise"
}

Rules:
- For angles OUTSIDE their reference range: include a corrective recommendation (e.g., "Raise saddle 5 mm")
- For angles WITHIN their reference range but within 10% of the range width from either boundary (e.g., for a 10° wide range, within 1° of min or max): include an optimization recommendation framed positively ("Your knee angle is good, but moving it slightly toward the center of the range would give you more margin on rough terrain")
- If all angles are comfortably within range (more than 10% of the range width from both boundaries): return an empty "recommendations" array and a positive summary in "raw_llm_response"
- Each recommendation must name the specific adjustment and its rationale, referencing the measured angle and the target range
- Follow the order of operations: saddle height before fore/aft before bar height before stem length
- Note coupling effects in the rationale where relevant`;

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

  const data = (await response.json()) as { choices: { message: { content: string } }[] };
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
          content: RECOMMENDATIONS_SYSTEM_PROMPT,
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

  const data = (await response.json()) as { choices: { message: { content: string } }[] };
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
