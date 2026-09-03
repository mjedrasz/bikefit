import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from "undici";
import { expect } from "vitest";

// The single place that mocks OpenRouter — at the HTTP edge, never by stubbing
// `analyzeVideo` / `generateRecommendations` themselves (test-plan §2: mock the network
// edge only). Node's global `fetch` is undici, so `setGlobalDispatcher(new MockAgent())`
// intercepts the exact `fetch` calls `src/lib/services/llm.ts` makes.
//
// The helper owns setup and teardown: `restore()` puts the real dispatcher back, so a
// leaked interceptor can never swallow a later suite's real fetch. Call `restore()` in
// `afterEach`.
//
//   const openrouter = installOpenRouterMock();
//   afterEach(() => { openrouter.restore(); });
//   it("rejects a truncated body", async () => {
//     openrouter.replyWith(200, '{"timestamps":[{"t":1,"type":"BDC"');
//     await expect(analyzeVideo("...")).rejects.toThrow();
//   });

const OPENROUTER_ORIGIN = "https://openrouter.ai";
const CHAT_COMPLETIONS_PATH = "/api/v1/chat/completions";

interface OpenRouterEnvelope {
  choices: { message: { content: string } }[];
}

function isEnvelope(body: unknown): body is OpenRouterEnvelope {
  return typeof body === "object" && body !== null && "choices" in body;
}

export interface OpenRouterMock {
  /**
   * Queue one reply. `body` is wrapped in the OpenRouter envelope
   * `{ choices: [{ message: { content: <stringified body> } }] }` unless it already looks
   * like a full envelope (has a `choices` key), in which case it is sent as-is.
   */
  replyWith(status: number, body: unknown): void;
  /** Queue one reply whose HTTP body is exactly `text` (non-JSON / truncated / malformed envelope). */
  replyRaw(status: number, text: string): void;
  /** Assert the mocked endpoint was hit exactly once. */
  assertCalledOnce(): void;
  /** Restore the real global dispatcher. Safe to call more than once. */
  restore(): void;
}

export function installOpenRouterMock(): OpenRouterMock {
  const original = getGlobalDispatcher();
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  const pool = agent.get(OPENROUTER_ORIGIN);

  let callCount = 0;
  let restored = false;

  const queue = (status: number, data: string) => {
    pool.intercept({ path: CHAT_COMPLETIONS_PATH, method: "POST" }).reply(() => {
      callCount += 1;
      return { statusCode: status, data, responseOptions: { headers: { "content-type": "application/json" } } };
    });
  };

  return {
    replyWith(status, body) {
      const envelope: OpenRouterEnvelope = isEnvelope(body)
        ? body
        : { choices: [{ message: { content: typeof body === "string" ? body : JSON.stringify(body) } }] };
      queue(status, JSON.stringify(envelope));
    },
    replyRaw(status, text) {
      queue(status, text);
    },
    assertCalledOnce() {
      expect(callCount).toBe(1);
    },
    restore() {
      if (restored) return;
      restored = true;
      setGlobalDispatcher(original);
      void agent.close();
    },
  };
}
