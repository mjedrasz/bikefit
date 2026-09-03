import { describe, expect, it } from "vitest";
import { stripJsonFence, timestampItemSchema, timestampListSchema } from "@/lib/llm-response";

// Pure-branch coverage for the OpenRouter `content` parsing helpers. In Stryker's `mutate`
// scope (`stryker.config.json`) — every branch below must have a distinct assertion.

describe("stripJsonFence", () => {
  it("strips a leading ```json fence and the trailing ```", () => {
    const body = '```json\n{"timestamps":[]}\n```';
    expect(stripJsonFence(body)).toBe('{"timestamps":[]}');
  });

  it("strips a bare ``` fence (no language tag)", () => {
    const body = '```\n{"timestamps":[]}\n```';
    expect(stripJsonFence(body)).toBe('{"timestamps":[]}');
  });

  it("tolerates leading/trailing whitespace around the fence", () => {
    const body = '  \n```json\n{"a":1}\n```\n  ';
    expect(stripJsonFence(body)).toBe('{"a":1}');
  });

  it("handles \\r\\n line endings", () => {
    const body = '```json\r\n{"a":1}\r\n```';
    expect(stripJsonFence(body)).toBe('{"a":1}');
  });

  it("returns the input unchanged when there is no leading fence", () => {
    const body = '{"timestamps":[{"t":1,"type":"BDC"}]}';
    expect(stripJsonFence(body)).toBe(body);
  });

  it("does not strip a trailing ``` when there is no leading fence", () => {
    const body = '{"a":1} ```';
    expect(stripJsonFence(body)).toBe(body);
  });

  it("collapses a fence-only body to an empty string (so JSON.parse still throws downstream)", () => {
    expect(stripJsonFence("```")).toBe("");
    expect(stripJsonFence("```json\n```")).toBe("");
  });

  it("keeps inner content that itself contains backtick runs", () => {
    const body = '```json\n{"note":"use ``` for code"}\n```';
    expect(stripJsonFence(body)).toBe('{"note":"use ``` for code"}');
  });
});

describe("timestampItemSchema", () => {
  it("accepts a well-formed item", () => {
    expect(timestampItemSchema.safeParse({ t: 1.5, type: "BDC" }).success).toBe(true);
  });

  it("accepts an optional frame number", () => {
    expect(timestampItemSchema.safeParse({ t: 1.5, f: 45, type: "TDC" }).success).toBe(true);
  });

  it("rejects a drifted enum value", () => {
    expect(timestampItemSchema.safeParse({ t: 1, type: "MIDDLE" }).success).toBe(false);
  });

  it("rejects a non-numeric timestamp", () => {
    expect(timestampItemSchema.safeParse({ t: "soon", type: "BDC" }).success).toBe(false);
  });

  it("rejects a missing type", () => {
    expect(timestampItemSchema.safeParse({ t: 1 }).success).toBe(false);
  });
});

describe("timestampListSchema", () => {
  it("accepts an empty list (the model's 'unsure' response)", () => {
    const parsed = timestampListSchema.safeParse([]);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual([]);
  });

  it("rejects a non-array", () => {
    expect(timestampListSchema.safeParse("nope").success).toBe(false);
  });

  it("rejects a list with one drifted item", () => {
    expect(
      timestampListSchema.safeParse([
        { t: 1, type: "BDC" },
        { t: 2, type: "MIDDLE" },
      ]).success,
    ).toBe(false);
  });
});
