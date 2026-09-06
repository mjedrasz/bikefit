# e2e (Playwright)

The one e2e smoke over `upload → analysing → results`, plus the deferred Risk #5 real
cross-user RLS check. Scaffolding lands in §3 Phase 4 of the test-plan rollout
(`context/changes/testing-quality-gates-e2e-smoke/`); the two `test()` cases land in Phase 4.

## Layout

| Path                                     | What                                                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `playwright.config.ts` (repo root)       | Two-server boot: the OpenRouter mock (`:4319`) + `npm run build && npm run preview` (workerd, `:4321`). Cross-project + `.dev.vars` guards. |
| `e2e/helpers/openrouter-mock-server.mjs` | Plain `node:http` stand-in for `openrouter.ai`. Branches on the request body's `model` field; unknown model → hard 500.                     |
| `e2e/helpers/seed-user.ts`               | _(Phase 4)_ Supabase Auth admin-API user + real `/api/auth/signin` → `storageState`.                                                        |
| `e2e/fixtures/`                          | _(Phase 4)_ the committed video fixture.                                                                                                    |

## Running locally

```bash
mv .dev.vars .dev.vars.bak     # see "secrets-file precedence" below
mv .env .env.bak               # (only if it defines SUPABASE_* / OPENROUTER_BASE_URL)
export E2E_SUPABASE_URL=https://<e2e-ref>.supabase.co
export E2E_SUPABASE_KEY=<e2e anon key>
export E2E_SUPABASE_SERVICE_ROLE_KEY=<e2e service role key>
npm run test:e2e
mv .dev.vars.bak .dev.vars && mv .env.bak .env   # restore for normal dev
```

The `E2E_*` values are the repo secrets recorded in Phase 2 (project **bikefit-e2e**). The
config remaps them to the `SUPABASE_*` names the app reads from `astro:env/server`.

### Secrets-file precedence (Phase 3 spike finding)

`astro build` (Cloudflare adapter) bakes `astro:env/server` secrets into
`dist/server/.dev.vars` **at build time**; `astro preview` reads only that frozen snapshot —
live `process.env` at preview time is ignored. At build time the source is, in strict
priority:

1. **`.dev.vars` if it exists** — used exclusively; `.env` and `process.env` are not consulted
   at all. A `.dev.vars` missing any required secret makes every preview request 500.
2. **else `.env` if it exists** — its values beat `process.env`.
3. **else `process.env`** — but only because `playwright.config.ts` sets
   `CLOUDFLARE_INCLUDE_PROCESS_ENV=true` on the build; without it the build emits no
   `dist/server/.dev.vars` and the preview 500s on the first missing secret.

So on a dev machine, a local `.dev.vars` (or a `SUPABASE_*`-carrying `.env`) silently wins
over the `webServer.env` remap and the run hits the wrong database. `playwright.config.ts`
throws if it sees either file — move them aside for the e2e run (the commands above), or
point their `SUPABASE_*` values at the e2e project.

**CI is unaffected**: a fresh checkout has neither file (both are gitignored), so
`process.env` (the job `env:`) is the only source, and the `CLOUDFLARE_INCLUDE_PROCESS_ENV`
flag makes the build pick it up.

## OpenRouter is mocked

The e2e run never calls OpenRouter live. `llm.ts` reads an optional `OPENROUTER_BASE_URL`
(`astro:env/server`); when set — only in the e2e run — both LLM calls go to the local mock.
Unset everywhere else, so production behaviour is byte-identical to before the field existed.
