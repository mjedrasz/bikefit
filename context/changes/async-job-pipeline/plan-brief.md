# Async Job Pipeline — Plan Brief

> Full plan: `context/changes/async-job-pipeline/plan.md`
> Research: `context/changes/ai-analysis-pipeline/research.md`

## What & Why

F-02 builds the server-side job contract that lets the browser-driven analysis flow communicate
its lifecycle back to the server: start → progress → result or failure. It is a prerequisite for
S-01 (video upload) and S-02 (AI analysis), both of which depend on this status-tracking API
existing before they can be implemented.

## Starting Point

F-01 (complete) gave us `fitting_sessions` with a `status` column (`queued | processing |
completed | failed`), a matching `analysis_results` table, TypeScript types for both, and RLS
configured so only `service_role` can write status transitions and results. The codebase has no
session API routes and no Zod validation — both patterns are introduced here.

## Desired End State

Three JSON API endpoints are live: a status polling endpoint the UI calls every N seconds, a
"start" endpoint the browser calls before analysis begins, and a results endpoint the browser
calls when analysis succeeds or fails. Calling them in sequence on a `queued` session produces
`queued → processing → completed` with a populated `analysis_results` row.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Queue mechanism | Supabase polling (no Queues/cron) | Lowest infra footprint for MVP; browser is the worker | Research |
| Worker scope | API only — no server-side worker scaffold | Avoids premature cron/container infra; production worker deferred to S-02 | Plan |
| State trigger | Explicit POST /start call from browser | Gives server an authoritative in-progress timestamp without requiring the UI to infer state | Plan |
| Polling contract | { status, updated_at } only | Minimal; UI only needs status for the progress indicator in S-01 | Plan |
| Failure reporting | Browser POSTs error payload to same /results endpoint | One endpoint, one contract; browser must handle failure explicitly | Plan |
| Input validation | Zod on results submission | CLAUDE.md convention; guards against malformed browser data corrupting analysis_results | Plan |
| Admin client | Shared factory in src/lib/services/supabase-admin.ts | Mirrors existing supabase.ts pattern; reused by S-02 and later slices | Plan |

## Scope

**In scope:**
- `SUPABASE_SERVICE_ROLE_KEY` in env schema and `.dev.vars`
- `src/lib/services/supabase-admin.ts` — service_role client factory
- `src/lib/schemas.ts` — Zod schemas for results payload
- `GET /api/sessions/:id` — status polling
- `POST /api/sessions/:id/start` — begin processing
- `POST /api/sessions/:id/results` — submit results or report error

**Out of scope:**
- Session creation (S-01), session list (S-04), results display (S-03)
- Server-side worker / cron trigger / Cloudflare Queues
- `video_r2_key` nulling after analysis (S-02)
- `wrangler.jsonc` changes

## Architecture / Approach

The browser is the pipeline worker in the MVP. The server's role is state bookkeeping: the
`fitting_sessions` row tracks the job lifecycle, and the three endpoints define the transitions.
Write-path endpoints use a service_role client (bypasses RLS) after verifying ownership via a
prior SELECT with the user-scoped RLS client — this keeps the ownership check in the RLS layer
and avoids duplicating access-control logic in application code.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Foundation | Zod, admin client, env var, schemas | SUPABASE_SERVICE_ROLE_KEY must be provisioned in .dev.vars before Phase 2 can be manually verified |
| 2. Status + Start | GET /sessions/:id, POST /sessions/:id/start | Introduces JSON API pattern new to codebase; must not accidentally use RLS client for the write |
| 3. Results submission | POST /sessions/:id/results (success + error) | Two-step write (INSERT then UPDATE) must not partially commit on failure |

**Prerequisites:** F-01 complete (done). `SUPABASE_SERVICE_ROLE_KEY` available from Supabase project settings.  
**Estimated effort:** ~1 session across 3 phases.

## Open Risks & Assumptions

- The `service_role` key has not been added to `.dev.vars` yet — Phase 1 manual verification is blocked until the developer does this
- Astro dynamic route coexistence (`[id].ts` alongside `[id]/` directory) is standard Astro behaviour but untested in this project; worth verifying in Phase 2 before Phase 3
- The two-step write in Phase 3 (INSERT results, then UPDATE status) is not atomic — if the UPDATE fails after a successful INSERT, the session stays `processing` with orphaned results; acceptable for MVP

## Success Criteria (Summary)

- Calling the three endpoints in order on a `queued` session produces `queued → processing → completed` with a valid `analysis_results` row in Supabase
- A different user's session returns 404 from all three endpoints
- A malformed results payload returns 400 with Zod error details
