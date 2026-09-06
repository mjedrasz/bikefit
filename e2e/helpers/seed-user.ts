// Real, throwaway Supabase Auth users for the e2e suite (plan §Phase 4).
//
// `createAdminClient` from app code imports `astro:env/server`, which Playwright's runner
// cannot resolve — so this helper builds its own service-role client from `process.env` and
// carries the same cross-project guard `playwright.config.ts` does: a run that would touch
// the real project throws here, before any user is created.
//
// Teardown is `admin.auth.admin.deleteUser`, which cascades to `fitting_sessions.user_id`
// and `analysis_results.session_id` (both `ON DELETE CASCADE`, initial_schema.sql) — no
// separate session/result cleanup is needed.

import { randomUUID } from "node:crypto";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import type { APIRequestContext } from "@playwright/test";

// Matches `playwright.config.ts` `use.baseURL` / the preview `webServer` port. Needed as an
// explicit `Origin` on the sign-in POST: Astro's `security.checkOrigin` (default-on for
// `output: "server"`) 403s a form-content-type POST whose `Origin` header doesn't equal the
// request origin, and Playwright's `request` fixture sends none. A real browser form always
// carries `Origin`, so this only bites the API-driven seed path.
const APP_ORIGIN = "http://localhost:4321";

const REAL_PROJECT_REF = "hucpghbsxwteiqknesus";
const E2E_URL = process.env.E2E_SUPABASE_URL ?? "";
const E2E_SERVICE_KEY = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!E2E_URL || E2E_URL.includes(REAL_PROJECT_REF)) {
  throw new Error(
    "seed-user: E2E_SUPABASE_URL is unset or points at the real project — refusing to seed/delete. " +
      "Export the dedicated e2e project's E2E_SUPABASE_* secrets; see plan Phase 2 and e2e/README.md.",
  );
}
if (!E2E_SERVICE_KEY) {
  throw new Error("seed-user: E2E_SUPABASE_SERVICE_ROLE_KEY is unset — cannot reach the Auth admin API.");
}

// Inferred, not `ReturnType<typeof createClient>`: the bare generic picks stricter default
// type args than a real call site, which then types `.from("fitting_sessions").insert(...)`
// as `never[]`. Derive the alias from this concrete factory instead — same shape the app's
// `createAdminClient()` exposes.
function adminClient() {
  return createClient(E2E_URL, E2E_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
type AdminClient = ReturnType<typeof adminClient>;

export interface SeededUser {
  userId: string;
  email: string;
  /** Service-role client bound to the e2e project — RLS-bypassing, for direct row seeding. */
  admin: AdminClient;
  /** Deletes the user; the FK cascade removes every row seeded under it. */
  teardown: () => Promise<void>;
}

/** A collision-proof address in a domain that will never receive mail. */
export function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomUUID()}@e2e.bikefit.test`;
}

/**
 * Create a confirmed Auth user via the admin API. No browser session — use this for a user
 * that only needs to *own* seeded rows (e.g. the session under test in the cross-user check).
 */
export async function createUser(email: string, password: string): Promise<SeededUser> {
  const admin = adminClient();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) {
    throw new Error(`seed-user: createUser failed for ${email}: ${error.message}`);
  }
  const userId = data.user.id;
  return {
    userId,
    email,
    admin,
    teardown: async () => {
      await admin.auth.admin.deleteUser(userId);
    },
  };
}

/**
 * `createUser`, then sign that user in through the real `/api/auth/signin` endpoint so
 * `request`'s cookie jar picks up a genuine `@supabase/ssr` session cookie (project-ref
 * derived, possibly chunked — never hand-built). Read it back with `request.storageState()`
 * for `browser.newContext({ storageState })`.
 */
export async function seedUser(request: APIRequestContext, email: string, password: string): Promise<SeededUser> {
  const user = await createUser(email, password);

  const res = await request.post("/api/auth/signin", {
    form: { email, password },
    headers: { origin: APP_ORIGIN },
  });
  // The endpoint 302s to `/` on success and to `/auth/signin?error=…` on failure — both
  // resolve to HTTP 200 after redirects, so the landing path is the real signal.
  if (!res.ok() || new URL(res.url()).pathname.startsWith("/auth/signin")) {
    await user.teardown().catch(() => undefined);
    throw new Error(`seed-user: sign-in failed for ${email} (HTTP ${res.status()}, landed on ${res.url()})`);
  }

  return user;
}
