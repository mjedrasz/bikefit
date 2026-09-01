import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// The suite covers pure logic only (angle math, formatters, verdict maps), so it does not
// need Astro's Vite plugin chain — `astro:env`, Tailwind, and React are all irrelevant to a
// `.ts` unit test over plain objects. `getViteConfig` from `astro/config` would drag the
// full build pipeline (incl. the Cloudflare adapter, which is incompatible with Vitest's
// `ssr` environment) into every test run, so we configure Vitest directly and re-declare
// only the one thing the specs rely on: the `@/*` path alias from tsconfig.
//
// `environment: "node"` is required by Astro 6 and sufficient here. When a later rollout
// phase needs `astro:env` or a DOM global in tests, revisit this file.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
  },
});
