// Mirror of `astro.config.mjs` `env.schema` — add a field here whenever the schema gains
// one, or route tests throw at import.
//
// Every route module transitively imports `astro:env/server` (via `createClient` →
// SUPABASE_URL/KEY, `createAdminClient` → SUPABASE_SERVICE_ROLE_KEY, `llm.ts` →
// OPENROUTER_API_KEY). `SUPABASE_SERVICE_ROLE_KEY` and `OPENROUTER_API_KEY` are
// `access: "secret"` *required*, so the real virtual module throws at import time when they
// are unset. Both Vitest projects alias `astro:env/server` to this file so a spec can import
// a route/service module without that throw. The values are fake but well-formed; behaviour
// is controlled per-test-file with `vi.mock` of `@/lib/supabase` /
// `@/lib/services/supabase-admin` and the OpenRouter network mock.

export const SUPABASE_URL = "http://stub.supabase.local";
export const SUPABASE_KEY = "stub-anon-key";
export const SUPABASE_SERVICE_ROLE_KEY = "stub-service-role-key";
export const OPENROUTER_API_KEY = "stub-openrouter-key";
