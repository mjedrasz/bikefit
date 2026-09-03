import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BodyAngle } from "@/types";
import { installOpenRouterMock, type OpenRouterMock } from "@/test/helpers/openrouter-mock";
import { analyzeVideo, generateRecommendations } from "./llm";

// OpenRouter contract suite (test-plan §6.3, Risk #2). Mock the HTTP edge only —
// `installOpenRouterMock` intercepts `POST https://openrouter.ai/api/v1/chat/completions`;
// `analyzeVideo` / `generateRecommendations` are never `vi.mock`-ed.
//
// The rule: every malformed / drifted / truncated / wrong-shape body produces a thrown
// `Error` whose message is one of the module's FIXED strings — never a resolved partial.
// The fenced-body and empty-`timestamps` cases assert a successful parse.

let openrouter: OpenRouterMock;

beforeEach(() => {
  openrouter = installOpenRouterMock();
});

afterEach(() => {
  openrouter.restore();
});

const ANGLES: BodyAngle[] = [{ name: "Knee extension", value: 145, reference_min: 140, reference_max: 150, unit: "°" }];

describe("analyzeVideo — OpenRouter contract", () => {
  it.each([429, 500, 403, 451])("rejects an upstream %i with a fixed message", async (status) => {
    openrouter.replyRaw(status, "upstream error detail that must not leak");

    await expect(analyzeVideo("dGVzdA==")).rejects.toThrow("OpenRouter vision request failed");
  });

  it("rejects a 200 with an empty HTTP body", async () => {
    openrouter.replyRaw(200, "");

    await expect(analyzeVideo("dGVzdA==")).rejects.toThrow(
      "OpenRouter returned a non-JSON response for vision request",
    );
  });

  it("rejects a 200 whose envelope has no choices", async () => {
    openrouter.replyWith(200, { choices: [] });

    await expect(analyzeVideo("dGVzdA==")).rejects.toThrow("OpenRouter returned no content for vision request");
  });

  it("rejects a 200 whose content is an empty string", async () => {
    openrouter.replyWith(200, "");

    await expect(analyzeVideo("dGVzdA==")).rejects.toThrow("OpenRouter returned no content for vision request");
  });

  it("parses a Markdown-fenced JSON body (success)", async () => {
    openrouter.replyWith(200, '```json\n{"timestamps":[{"t":1.25,"f":40,"type":"BDC"}]}\n```');

    await expect(analyzeVideo("dGVzdA==")).resolves.toEqual({ timestamps: [{ t: 1.25, f: 40, type: "BDC" }] });
  });

  it("resolves an empty timestamp list (the model's documented 'unsure' response)", async () => {
    openrouter.replyWith(200, { timestamps: [] });

    await expect(analyzeVideo("dGVzdA==")).resolves.toEqual({ timestamps: [] });
  });

  it("rejects a truncated JSON content string", async () => {
    openrouter.replyWith(200, '{"timestamps":[{"t":1,"type":');

    await expect(analyzeVideo("dGVzdA==")).rejects.toThrow("Vision LLM returned invalid JSON");
  });

  it("rejects timestamps that is not an array", async () => {
    openrouter.replyWith(200, { timestamps: "nope" });

    await expect(analyzeVideo("dGVzdA==")).rejects.toThrow("Vision LLM returned a malformed timestamp list");
  });

  it("rejects a drifted enum value in an item", async () => {
    openrouter.replyWith(200, { timestamps: [{ t: 1, type: "MIDDLE" }] });

    await expect(analyzeVideo("dGVzdA==")).rejects.toThrow("Vision LLM returned a malformed timestamp list");
  });

  it("rejects a non-numeric timestamp in an item", async () => {
    openrouter.replyWith(200, { timestamps: [{ t: "soon", type: "BDC" }] });

    await expect(analyzeVideo("dGVzdA==")).rejects.toThrow("Vision LLM returned a malformed timestamp list");
  });

  it("never leaks the upstream body in the thrown message", async () => {
    openrouter.replyRaw(500, '{"error":{"message":"secret upstream reason"}}');

    await expect(analyzeVideo("dGVzdA==")).rejects.not.toThrow(/secret upstream reason/);
  });
});

describe("generateRecommendations — OpenRouter contract", () => {
  it.each([429, 500, 403, 451])("rejects an upstream %i with a fixed message", async (status) => {
    openrouter.replyRaw(status, "upstream error detail that must not leak");

    await expect(generateRecommendations(ANGLES)).rejects.toThrow("OpenRouter text request failed");
  });

  it("rejects a 200 with an empty HTTP body", async () => {
    openrouter.replyRaw(200, "");

    await expect(generateRecommendations(ANGLES)).rejects.toThrow(
      "OpenRouter returned a non-JSON response for recommendations request",
    );
  });

  it("rejects a 200 whose content is an empty string", async () => {
    openrouter.replyWith(200, "");

    await expect(generateRecommendations(ANGLES)).rejects.toThrow(
      "OpenRouter returned no content for recommendations request",
    );
  });

  it("rejects a truncated JSON content string", async () => {
    openrouter.replyWith(200, '{"recommendations":[{"adjustment":');

    await expect(generateRecommendations(ANGLES)).rejects.toThrow("Recommendations LLM returned invalid JSON");
  });

  it("rejects a malformed recommendation item shape", async () => {
    openrouter.replyWith(200, { recommendations: [{ foo: 1 }], raw_llm_response: "..." });

    await expect(generateRecommendations(ANGLES)).rejects.toThrow(
      "Recommendations LLM returned a malformed recommendation list",
    );
  });

  it("rejects recommendations that is not an array", async () => {
    openrouter.replyWith(200, { recommendations: "nope", raw_llm_response: "..." });

    await expect(generateRecommendations(ANGLES)).rejects.toThrow(
      "Recommendations LLM returned a malformed recommendation list",
    );
  });

  it("rejects a well-formed list that is missing raw_llm_response", async () => {
    openrouter.replyWith(200, { recommendations: [{ adjustment: "Raise saddle 5mm", rationale: "Knee too bent" }] });

    await expect(generateRecommendations(ANGLES)).rejects.toThrow(
      "Recommendations LLM response missing raw_llm_response string",
    );
  });

  it("parses a Markdown-fenced JSON body (success)", async () => {
    openrouter.replyWith(
      200,
      '```json\n{"recommendations":[{"adjustment":"Raise saddle 5mm","rationale":"Knee too bent"}],"raw_llm_response":"raw"}\n```',
    );

    await expect(generateRecommendations(ANGLES)).resolves.toEqual({
      recommendations: [{ adjustment: "Raise saddle 5mm", rationale: "Knee too bent" }],
      raw_llm_response: "raw",
    });
  });

  it("resolves a well-formed response", async () => {
    openrouter.replyWith(200, {
      recommendations: [{ adjustment: "Raise saddle 5mm", rationale: "Knee angle below reference band" }],
      raw_llm_response: "the model's raw text",
    });

    await expect(generateRecommendations(ANGLES)).resolves.toEqual({
      recommendations: [{ adjustment: "Raise saddle 5mm", rationale: "Knee angle below reference band" }],
      raw_llm_response: "the model's raw text",
    });
  });
});
