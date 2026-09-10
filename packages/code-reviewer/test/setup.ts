// Load packages/code-reviewer/.env before any test runs. Vitest does not read
// .env files the way the CLI does (src/cli.ts calls process.loadEnvFile()), so
// the opt-in integration test would otherwise never see OPENROUTER_API_KEY.
// Resolved relative to this file so it works regardless of the cwd vitest is
// launched from.
try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
} catch {
  // No .env file — fall back to the ambient environment (this is the norm for
  // the unit suite, which uses a fake client and needs no key).
}
