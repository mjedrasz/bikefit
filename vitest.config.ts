import { fileURLToPath } from "node:url";
import react from "@astrojs/react";
import { getViteConfig } from "astro/config";
import { defineConfig } from "vitest/config";

// Two Vitest projects, split by what the specs need from the build pipeline:
//
// - `unit` — a plain `defineConfig` (no Astro Vite plugin). Covers the bulk of the suite:
//   pure-logic units (§3 Phase 1), API route-handler integration tests, and the OpenRouter
//   contract suite. Fast; nothing here compiles a `.astro` file.
// - `pages` — built from `getViteConfig` so the Astro Vite plugin is present and a
//   `.astro` import in a spec compiles (a plain `defineConfig` fails such an import at
//   `vite:import-analysis`). Scoped to the two SSR-page spec files in `src/pages/sessions/`
//   that drive the Container API. `configFile: false` drops `astro.config.mjs` — and with
//   it the `@astrojs/cloudflare` adapter, which is incompatible with Vitest's `ssr`
//   environment — keeping only the React renderer that `client:*` islands need.
//
// Both projects alias `astro:env/server` to `src/test/stubs/astro-env-server.ts`: every
// route/service module imports required secrets from that virtual module at import time and
// would throw without it (`pages` needs the alias too — `getViteConfig` wires the *real*
// virtual module). Behaviour is controlled per-spec with `vi.mock` + the stub helpers under
// `src/test/`.

const srcAlias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
};
const astroEnvAlias = {
  "astro:env/server": fileURLToPath(new URL("./src/test/stubs/astro-env-server.ts", import.meta.url)),
};

const PAGE_SPECS = "src/pages/sessions/*.{test,spec}.ts";

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias: { ...srcAlias, ...astroEnvAlias } },
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.{test,spec}.ts"],
          exclude: [PAGE_SPECS],
        },
      },
      getViteConfig(
        {
          resolve: { alias: { ...srcAlias, ...astroEnvAlias } },
          test: {
            name: "pages",
            environment: "node",
            include: [PAGE_SPECS],
          },
        },
        { configFile: false, output: "server", integrations: [react()] },
      ),
    ],
  },
});
