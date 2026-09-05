// Rejects an oversized request body before paying the memory/CPU cost of buffering and
// parsing it (test-plan §3 Phase 3, Risk #3). Closes the timing gap in the existing
// schema-only `.max()` cap, which only rejects *after* `context.request.json()` has already
// buffered the full body.
//
// Two layers, cheapest first: a `Content-Length` fast-check (rejects without touching the
// body at all), then a streamed byte count for chunked-encoding requests that carry no
// `Content-Length` header.

export type CappedJsonResult = { ok: true; data: unknown } | { ok: false; reason: "too-large" | "invalid-json" };

function concatChunks(chunks: Uint8Array[], totalLength: number): Uint8Array {
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function readJsonWithCap(request: Request, maxBytes: number): Promise<CappedJsonResult> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return { ok: false, reason: "too-large" };
  }

  const chunks: Uint8Array[] = [];
  let total = 0;

  if (request.body) {
    const reader = request.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          return { ok: false, reason: "too-large" };
        }
        chunks.push(value);
      }
    } catch {
      // A genuine stream error (e.g. the client drops the connection mid-upload) — degrade to
      // the same structured error the JSON.parse failure below returns, not an unhandled
      // rejection out of the route handler.
      await reader.cancel().catch(() => undefined);
      return { ok: false, reason: "invalid-json" };
    }
  }

  try {
    const text = new TextDecoder().decode(concatChunks(chunks, total));
    return { ok: true, data: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
}
