import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: process.env.OPENROUTER_RUN_INTEGRATION ? 120_000 : 10_000,
  },
});
