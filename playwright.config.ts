import { existsSync, readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// --- Cross-project safety -----------------------------------------------------------------
// Refuse to run against anything but the dedicated e2e Supabase project. The project
// boundary ("bikefit-e2e") is the containment; this guard is the enforcement — a run that
// would touch the real ref ("mjedrasz's Project") throws here, before any server boots or
// any user is seeded. `e2e/helpers/seed-user.ts` (Phase 4) carries the same check at seed
// time as defence in depth.
const REAL_PROJECT_REF = "hucpghbsxwteiqknesus";
const E2E_SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? "";
if (!E2E_SUPABASE_URL || E2E_SUPABASE_URL.includes(REAL_PROJECT_REF)) {
  throw new Error(
    "E2E_SUPABASE_URL is unset or points at the real project — refusing to run. " +
      "Export it (and E2E_SUPABASE_KEY / E2E_SUPABASE_SERVICE_ROLE_KEY) for the dedicated e2e project; see plan Phase 2.",
  );
}

// --- Local secrets-file guard ----------------------------------------------------------
// Phase 3 spike finding (3.4/3.5): `astro build` (Cloudflare adapter) bakes env vars into
// `dist/server/.dev.vars` AT BUILD TIME, and `astro preview` reads only that frozen snapshot
// — live `process.env` at preview time is ignored for `astro:env/server` secrets. At build
// time the source is, in strict priority: (1) `.dev.vars` if it exists — exclusively, nothing
// else consulted; (2) else `.env` if it exists — beats `process.env`; (3) else `process.env`,
// but only because we pass `CLOUDFLARE_INCLUDE_PROCESS_ENV=true` below. So on a dev machine a
// `.dev.vars` or a `SUPABASE_*`-carrying `.env` silently wins over the `webServer.env` remap
// and the run hits the wrong database. CI has neither file, so this only bites local runs.
if (!process.env.CI) {
  const shadowing = [".dev.vars", ".env"].filter((file) => {
    if (!existsSync(file)) return false;
    if (file === ".dev.vars") return true; // any `.dev.vars` shadows the remap entirely
    return readFileSync(file, "utf8")
      .split("\n")
      .some((line) => /^\s*(SUPABASE_(URL|KEY|SERVICE_ROLE_KEY)|OPENROUTER_BASE_URL)\s*=/.test(line));
  });
  if (shadowing.length > 0) {
    throw new Error(
      `${shadowing.join(" and ")} would override playwright.config's webServer.env in the workerd ` +
        "preview build (Phase 3 spike) — the run could hit the wrong database. Move the file(s) aside " +
        "for the e2e run (e.g. `mv .dev.vars .dev.vars.bak`), or point their SUPABASE_* values at the " +
        "e2e project. See e2e/README.md.",
    );
  }
}

// --- Two-server boot ---------------------------------------------------------------------
// Playwright starts both `webServer` entries concurrently and waits on each one's own
// health-check before any test runs. No explicit ordering is needed: the preview server
// only calls the mock once a test triggers `/api/analyze`, by which point both are up.
// Playwright already merges the parent `process.env` under each entry's `env`
// (webServerPlugin: `{ ...process.env, ...options.env }`), so only the overrides are listed.
export default defineConfig({
  testDir: "./e2e",
  // Real CPU pose detection runs unmocked (only the two OpenRouter calls are stubbed); the
  // pipeline is single-digit minutes — see plan §Performance Considerations.
  timeout: 300_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://localhost:4321",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node e2e/helpers/openrouter-mock-server.mjs",
      port: 4319,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      // Cloudflare adapter: `astro preview` runs the workerd sandbox and needs a prior
      // `astro build` to produce `.wrangler/deploy/config.json`.
      command: "npm run build && npm run preview",
      url: "http://localhost:4321/",
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: {
        // `astro build` (Cloudflare adapter) resolves `astro:env/server` secrets from
        // `process.env` ONLY with this flag set (Phase 3 spike) — without it the build emits
        // no `dist/server/.dev.vars` and every preview request 500s on a missing secret.
        CLOUDFLARE_INCLUDE_PROCESS_ENV: "true",
        // The app reads these names from `astro:env/server`. The `E2E_*` secret names are
        // labels for the GitHub Secrets UI only — remapped to the names the app actually
        // reads here, at the point of use. Cross-project safety is the guard above.
        SUPABASE_URL: E2E_SUPABASE_URL,
        SUPABASE_KEY: process.env.E2E_SUPABASE_KEY ?? "",
        SUPABASE_SERVICE_ROLE_KEY: process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ?? "",
        // Never dereferenced against a real endpoint — the mock ignores the Authorization header.
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? "e2e-mock-unused",
        // Redirect `llm.ts`'s OpenRouter call to the mock server (first webServer entry).
        OPENROUTER_BASE_URL: "http://127.0.0.1:4319/api/v1/chat/completions",
      },
    },
  ],
});
