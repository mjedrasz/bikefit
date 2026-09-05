import { describe, expect, it } from "vitest";
import { readJsonWithCap } from "./capped-json-body";

// `readJsonWithCap` against plain `Request`/`ReadableStream` fixtures (test-plan §3 Phase 3,
// Risk #3). The `Content-Length` fast-check must reject without touching the body at all —
// proven here by never allocating an actual oversized payload. The streamed byte-count path
// is exercised separately via a body with no `Content-Length` header (chunked encoding).

function requestWithBody(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://test.local/api", { method: "POST", headers, body });
}

function requestWithStreamedBody(chunks: string[]): Request {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Request("http://test.local/api", {
    method: "POST",
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("readJsonWithCap", () => {
  it("parses a well-formed body under the cap", async () => {
    const req = requestWithBody(JSON.stringify({ a: 1 }));

    const result = await readJsonWithCap(req, 1_000);

    expect(result).toEqual({ ok: true, data: { a: 1 } });
  });

  it("rejects via the Content-Length fast-check, without reading the stream", async () => {
    // A spoofed `Content-Length` far larger than the real (small) body — the fast-check
    // must reject on the header alone, never buffering the body to find out.
    const req = requestWithBody("{}", { "content-length": "999999999" });

    const result = await readJsonWithCap(req, 1_000);

    expect(result).toEqual({ ok: false, reason: "too-large" });
  });

  it("rejects a chunked-encoding body (no Content-Length) once the streamed byte count exceeds the cap", async () => {
    const req = requestWithStreamedBody(["12345", "67890", "extra"]);
    expect(req.headers.get("content-length")).toBeNull();

    const result = await readJsonWithCap(req, 10);

    expect(result).toEqual({ ok: false, reason: "too-large" });
  });

  it("accepts a chunked-encoding body under the cap", async () => {
    const req = requestWithStreamedBody(['{"a"', ":1}"]);

    const result = await readJsonWithCap(req, 1_000);

    expect(result).toEqual({ ok: true, data: { a: 1 } });
  });

  it("returns invalid-json for a well-formed, under-cap body that isn't valid JSON", async () => {
    const req = requestWithBody("not json");

    const result = await readJsonWithCap(req, 1_000);

    expect(result).toEqual({ ok: false, reason: "invalid-json" });
  });
});
