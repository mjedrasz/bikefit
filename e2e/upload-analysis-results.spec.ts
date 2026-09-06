// The one e2e smoke over upload → analysing → results, plus the deferred Risk #5 real
// cross-user RLS check (test-plan §6.4/§6.6). Exactly two `test()` cases in one spec file —
// see plan §Definitions for why "one e2e smoke" permits the second, narrowly-scoped case.
//
// What runs for real: the whole client-driven pipeline (5 sequential API calls from the
// browser), session lifecycle, CPU pose detection, and deployed RLS. Only the two OpenRouter
// calls are stubbed — by the local mock server on :4319 (playwright.config.ts webServer[0]),
// reached because `OPENROUTER_BASE_URL` points `llm.ts` at it.

import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { createUser, seedUser, uniqueEmail } from "./helpers/seed-user";

const FIXTURE = fileURLToPath(new URL("./fixtures/bike-fit-sample.mp4", import.meta.url));
const PASSWORD = "e2e-Test-Password-1x!";

// Serial suite (playwright.config.ts: workers 1, fullyParallel false), so a plain module
// array is race-free. Drained in afterEach — which runs even after a failed test, so a CI
// retry re-seeds cleanly.
const pendingTeardowns: (() => Promise<void>)[] = [];

test.afterEach(async () => {
  for (const teardown of pendingTeardowns.splice(0)) {
    await teardown().catch(() => {
      // Best effort: an orphaned user in the throwaway e2e project is accepted (plan §Definitions).
    });
  }
});

test("uploads a video and reaches the fitting results page", async ({ browser, request }) => {
  const user = await seedUser(request, uniqueEmail("smoke"), PASSWORD);
  pendingTeardowns.push(user.teardown);

  const context = await browser.newContext({ storageState: await request.storageState() });
  const page = await context.newPage();

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Upload your riding video" })).toBeVisible();

  // The file input is visually hidden but present in the DOM (VideoUpload.tsx).
  await page.setInputFiles('input[type="file"]', FIXTURE);

  // The pipeline is single-digit minutes (real CPU pose detection; only the LLM calls are
  // mocked — plan §Performance Considerations). It ends by rendering this link.
  const resultsLink = page.getByRole("link", { name: "View fitting recommendations" });
  await expect(resultsLink).toBeVisible({ timeout: 240_000 });
  await resultsLink.click();

  await expect(page.getByRole("heading", { name: "Your fitting results" })).toBeVisible();
  await expect(page.getByText(/In range|Outside range/).first()).toBeVisible();

  await context.close();
});

test("user B cannot read user A's session", async ({ browser, request }) => {
  // User A only needs to *own* a session row — no browser session, no upload pipeline, so
  // this case has zero LLM or pose-detection dependency.
  const userA = await createUser(uniqueEmail("owner"), PASSWORD);
  pendingTeardowns.push(userA.teardown);

  const inserted = await userA.admin
    .from("fitting_sessions")
    .insert({ user_id: userA.userId, status: "completed", video_filename: "seed.mp4", video_duration_s: 3 })
    .select("id")
    .single();
  expect(inserted.error).toBeNull();
  const sessionId = (inserted.data as unknown as { id: string }).id;

  const userB = await seedUser(request, uniqueEmail("intruder"), PASSWORD);
  pendingTeardowns.push(userB.teardown);

  const context = await browser.newContext({ storageState: await request.storageState() });
  const page = await context.newPage();

  // `sessions/[id].astro` is a pure RLS read — no application-level `user_id` filter anywhere
  // in the file — so a 404 here can only come from `sessions_select_own` denying the row.
  const response = await page.goto(`/sessions/${sessionId}`);
  expect(response?.status()).toBe(404);

  await context.close();
});
