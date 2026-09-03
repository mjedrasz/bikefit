import { afterEach, describe, expect, it } from "vitest";
import { getGlobalDispatcher } from "undici";
import { installOpenRouterMock } from "@/test/helpers/openrouter-mock";

// Guards the teardown contract: `restore()` must put the real global dispatcher back so a
// leaked interceptor cannot swallow a later suite's real `fetch` (test-plan §2 note on the
// undici MockAgent lifecycle).

describe("installOpenRouterMock", () => {
  const originalDispatcher = getGlobalDispatcher();

  afterEach(() => {
    // Belt-and-braces: even if an assertion below fails mid-test, do not leak the mock.
    if (getGlobalDispatcher() !== originalDispatcher) {
      throw new Error("openrouter-mock leaked the global dispatcher past restore()");
    }
  });

  it("intercepts the OpenRouter chat-completions endpoint while installed", async () => {
    const openrouter = installOpenRouterMock();
    openrouter.replyWith(200, { timestamps: [] });

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      body: "{}",
    });
    const body = (await res.json()) as { choices: { message: { content: string } }[] };

    expect(res.status).toBe(200);
    expect(JSON.parse(body.choices[0].message.content)).toEqual({ timestamps: [] });
    openrouter.assertCalledOnce();

    openrouter.restore();
  });

  it("restores the original dispatcher after restore()", () => {
    const openrouter = installOpenRouterMock();
    expect(getGlobalDispatcher()).not.toBe(originalDispatcher);

    openrouter.restore();
    expect(getGlobalDispatcher()).toBe(originalDispatcher);

    // idempotent
    openrouter.restore();
    expect(getGlobalDispatcher()).toBe(originalDispatcher);
  });
});
