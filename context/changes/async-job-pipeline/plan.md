# Async Job Pipeline Implementation Plan

## Overview

Build the three JSON API endpoints and service-layer plumbing that define the async job contract
for the BikeFit analysis pipeline. The browser-side analysis flow will use these to (1) mark a
session as in-progress, (2) poll status, and (3) submit results or report failure. This foundation
unblocks S-01 (video upload) and S-02 (AI analysis pipeline).

## Current State Analysis

F-01 is complete. The following already exists:

- `fitting_sessions` table with `status` CHECK constraint (`queued | processing | completed | failed`) and `updated_at` trigger — `supabase/migrations/20260526120000_initial_schema.sql`
- `analysis_results` table for JSONB recommendations and body angles
- `SessionStatus`, `FittingSession`, `AnalysisResult`, `Recommendation`, `BodyAngle` types — `src/types.ts`
- RLS: authenticated users can SELECT/INSERT their own sessions; all status updates and result writes require `service_role` (no UPDATE/DELETE policy for authenticated role)
- `src/lib/supabase.ts` — cookie-based SSR client factory (user-authenticated, respects RLS)
- `astro.config.mjs` — env schema has `SUPABASE_URL` and `SUPABASE_KEY`; `SUPABASE_SERVICE_ROLE_KEY` is missing

Missing for F-02:

- `SUPABASE_SERVICE_ROLE_KEY` in env schema and `.dev.vars`
- `src/lib/services/` directory (does not exist)
- Admin Supabase client factory (service_role, bypasses RLS)
- Zod (`zod` package not installed) and Zod schemas for API input validation
- Three new JSON API routes (no session routes exist; existing routes are form-data/redirect)

## Desired End State

Three API endpoints live and callable:

1. `GET /api/sessions/:id` — returns `{ status, updated_at }` for the authenticated user's session; 404 for non-existent or another user's session
2. `POST /api/sessions/:id/start` — transitions `queued → processing`; returns `{ ok: true }`; 409 if not in `queued` state
3. `POST /api/sessions/:id/results` — accepts either `{ recommendations, body_angles }` (success) or `{ error: true, error_message }` (failure); validates with Zod; writes to DB; returns `{ ok: true }`

**Verify**: with a `queued` session in local Supabase, running the three calls in sequence produces status `queued → processing → completed` and a populated `analysis_results` row.

### Key Discoveries

- `supabase/migrations/20260526120000_initial_schema.sql` — schema complete; no new migration needed for F-02
- `src/lib/supabase.ts` — factory pattern to mirror for the admin client
- `src/pages/api/auth/signin.ts:1-21` — canonical Astro API route shape; F-02 routes use JSON bodies and `Response.json()` instead of redirect (new pattern for this codebase)
- `astro.config.mjs` — env schema block is where `SUPABASE_SERVICE_ROLE_KEY` must be added (uses `envField.string({ context: 'server', access: 'secret' })`)

## What We're NOT Doing

- No server-side worker, cron trigger, or Cloudflare Queues — browser-side MVP only; production worker deferred to S-02
- No `video_r2_key` nulling after analysis — deferred to S-02
- No session creation endpoint — that belongs to S-01
- No session list endpoint — that belongs to S-04
- No retry logic for failed sessions
- No `wrangler.jsonc` changes

## Implementation Approach

Three sequential phases: (1) plumbing — env var, admin client, Zod schemas; (2) status polling
and session start endpoints (read + state-change); (3) results submission endpoint (write path).
Each phase is independently verifiable. No new infrastructure.

The ownership check pattern across all write endpoints: use the cookie-based (RLS) client to
SELECT the session first — RLS returns nothing if the session belongs to another user, so a
missing row from that SELECT doubles as a 404 and an ownership guard. Only then use the admin
client for the write.

---

## Phase 1: Foundation

### Overview

Install Zod, wire `SUPABASE_SERVICE_ROLE_KEY` into the Astro env schema, create the admin Supabase
client factory, and define Zod schemas for the results payload. No routes yet — only the plumbing
S-02 and future slices will also reuse.

### Changes Required

#### 1. Install Zod

**File**: `package.json` (via `npm install`)

**Intent**: Add Zod as a runtime dependency so API routes can validate JSON payloads.

**Contract**: Run `npm install zod`. No existing packages conflict.

#### 2. Env schema — add SUPABASE_SERVICE_ROLE_KEY

**File**: `astro.config.mjs`

**Intent**: Register the service_role key as a server-only secret so it is available in routes via `import { SUPABASE_SERVICE_ROLE_KEY } from 'astro:env/server'`.

**Contract**: In the `env.schema` block alongside the existing `SUPABASE_URL` and `SUPABASE_KEY` entries, add `SUPABASE_SERVICE_ROLE_KEY: envField.string({ context: 'server', access: 'secret' })`.

#### 3. Admin Supabase client factory

**File**: `src/lib/services/supabase-admin.ts`

**Intent**: Provide a single place to create a service_role Supabase client. Called by any route that must write to DB as the pipeline worker (status transitions, result inserts). Creates the `src/lib/services/` directory.

**Contract**: Export `createAdminClient()` returning a `SupabaseClient` initialised with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `astro:env/server`, with `auth: { autoRefreshToken: false, persistSession: false }`. No null guard needed — if the env var is absent Astro throws at startup before any route runs.

#### 4. Zod schemas

**File**: `src/lib/schemas.ts`

**Intent**: Define the canonical validation shape for the results submission payload so the API route rejects malformed data before it touches the DB. Derives from the existing `Recommendation` and `BodyAngle` types in `src/types.ts`.

**Contract**: Export the following Zod schemas:
- `recommendationSchema` — `{ adjustment: z.string(), rationale: z.string() }`
- `bodyAngleSchema` — `{ name: z.string(), value: z.number(), reference_min: z.number(), reference_max: z.number(), unit: z.string() }`
- `resultsPayloadSchema` — `z.discriminatedUnion('error', [...])` with two branches: success (`error: z.literal(false).optional()`, `recommendations: z.array(recommendationSchema)`, `body_angles: z.array(bodyAngleSchema)`) and failure (`error: z.literal(true)`, `error_message: z.string()`)

### Success Criteria

#### Automated Verification

- `npm install zod` completes without error
- `npm run typecheck` — no errors; `SUPABASE_SERVICE_ROLE_KEY` resolves from `astro:env/server` in `supabase-admin.ts`
- `npm run lint` — passes on new files

#### Manual Verification

- `SUPABASE_SERVICE_ROLE_KEY` set in `.dev.vars` to the project's service_role key (from Supabase project settings)
- `createAdminClient()` returns a connected client (verify in Phase 2 by successfully running a status update)

**Implementation Note**: After completing this phase and automated verification passes, pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Status and Start Endpoints

### Overview

Two new API routes establish the JSON endpoint pattern for this codebase: the status polling
endpoint (GET, regular RLS client) and the session start endpoint (POST, admin client for the
status write).

### Changes Required

#### 1. Status polling endpoint

**File**: `src/pages/api/sessions/[id].ts`

**Intent**: Let the browser-side UI poll the current status of a session it owns. Returns a minimal payload — status + timestamp — matching what S-01's processing indicator needs.

**Contract**:
- Export `GET: APIRoute` and `export const prerender = false`.
- Check `context.locals.user`; return `new Response(null, { status: 401 })` if absent.
- Create the cookie-based client; if `createClient()` returns `null`, return `new Response('Service unavailable', { status: 503 })`.
- Use the cookie-based client (not the admin client — RLS auto-enforces ownership).
- SELECT `status, updated_at` from `fitting_sessions` WHERE `id = params.id` using `.single()`.
- If Supabase returns an error or no row: `new Response(null, { status: 404 })`.
- Success: `Response.json({ status, updated_at })`.

#### 2. Session start endpoint

**File**: `src/pages/api/sessions/[id]/start.ts`

**Intent**: Mark a session as in-progress the moment the browser begins analysis. Gives the polling endpoint a `processing` state to return and records when work began on the server.

**Contract**:
- Export `POST: APIRoute` and `export const prerender = false`.
- Check `context.locals.user`; return 401 if absent.
- Create the cookie-based client; if `createClient()` returns `null`, return `new Response('Service unavailable', { status: 503 })`.
- Use the cookie-based client to SELECT `id, status` WHERE `id = params.id` using `.single()`; 404 if no row.
- If `status !== 'queued'`: return `Response.json({ error: 'Session is not in queued state' }, { status: 409 })`.
- Use `createAdminClient()` to `UPDATE fitting_sessions SET status = 'processing' WHERE id = params.id`.
- Success: `Response.json({ ok: true })`.

### Success Criteria

#### Automated Verification

- `npm run typecheck` — passes on both new routes
- `npm run lint` — passes

#### Manual Verification

- GET /api/sessions/:id with a valid session ID and authenticated cookie → `{ status: 'queued', updated_at: '...' }`
- GET /api/sessions/:id with an ID belonging to a different user → 404
- POST /api/sessions/:id/start on a `queued` session → row in Supabase flips to `processing`; response `{ ok: true }`
- POST /api/sessions/:id/start on the same session a second time → 409

**Implementation Note**: After completing this phase and automated verification passes, pause for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Results Submission Endpoint

### Overview

The single endpoint the browser calls when analysis completes or fails. Validates with Zod,
verifies ownership, and transitions the session to its terminal state.

### Changes Required

#### 1. Results submission endpoint

**File**: `src/pages/api/sessions/[id]/results.ts`

**Intent**: Accept the browser's completed analysis (recommendations + body angles) or an explicit error report, persist the outcome, and transition the session to `completed` or `failed`. This is the only path to a terminal state in the browser-WASM MVP.

**Contract**:
- Export `POST: APIRoute` and `export const prerender = false`.
- Check `context.locals.user`; return 401 if absent.
- Parse request body: `await request.json()` — wrap in try/catch; return 400 on parse failure.
- Validate against `resultsPayloadSchema`; on Zod failure return `Response.json({ error: 'Invalid payload', details: result.error.flatten() }, { status: 400 })`.
- Create the cookie-based client; if `createClient()` returns `null`, return `new Response('Service unavailable', { status: 503 })`.
- Use cookie-based client to SELECT `id, status` WHERE `id = params.id`; 404 if missing.
- If `status !== 'processing'`: return 409 with `{ error: 'Session is not in processing state' }`.
- **Success path** (`error` field absent or `false`): use `createAdminClient()` to INSERT into `analysis_results (session_id, recommendations, body_angles)` — if INSERT fails return 500 without touching session status. Then UPDATE `fitting_sessions SET status = 'completed'`.
- **Error path** (`error: true`): use `createAdminClient()` to UPDATE `fitting_sessions SET status = 'failed', error_message = payload.error_message`.
- Both paths return `Response.json({ ok: true })` on success.

### Success Criteria

#### Automated Verification

- `npm run typecheck` — passes
- `npm run lint` — passes

#### Manual Verification

- POST with `{ recommendations: [...], body_angles: [...] }` to a `processing` session → status = `completed`; `analysis_results` row exists with correct JSONB
- POST with `{ error: true, error_message: 'MediaPipe failed to detect pose' }` to a `processing` session → status = `failed`; `error_message` set
- POST with malformed payload (missing `recommendations` on success branch) → 400 with Zod error details
- POST to a `queued` (not yet started) session → 409
- POST from a different authenticated user for the same session → 404

---

## Testing Strategy

### Manual Testing Steps

1. In local Supabase Studio, insert a `fitting_sessions` row with `status = 'queued'` for the signed-in user
2. Use browser DevTools (or `curl`) to call the three endpoints in order: GET → POST /start → POST /results
3. Verify status transitions in Supabase Studio after each call
4. Repeat as a second user (sign in with a different account) to verify 404 isolation
5. Test the error path by POSTing `{ error: true, error_message: 'test' }` to a `processing` session

## References

- Schema: `supabase/migrations/20260526120000_initial_schema.sql`
- Types: `src/types.ts`
- Supabase client pattern: `src/lib/supabase.ts`
- Canonical API route: `src/pages/api/auth/signin.ts:1-21`
- Roadmap F-02: `context/foundation/roadmap.md` lines 76–87
- AI analysis research: `context/changes/ai-analysis-pipeline/research.md`
- Pose estimation research: `context/changes/ai-analysis-pipeline/pose-estimation-research.md`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Foundation

#### Automated

- [x] 1.1 npm install zod completes without error — 7a46915
- [x] 1.2 npm run typecheck — no errors including SUPABASE_SERVICE_ROLE_KEY from astro:env/server — 7a46915
- [x] 1.3 npm run lint — passes on new files — 7a46915

#### Manual

- [x] 1.4 SUPABASE_SERVICE_ROLE_KEY set in .dev.vars; createAdminClient() returns a connected client

### Phase 2: Status and Start Endpoints

#### Automated

- [x] 2.1 npm run typecheck — passes on both new routes — c6cb684
- [x] 2.2 npm run lint — passes — c6cb684

#### Manual

- [x] 2.3 GET /api/sessions/:id returns { status, updated_at } for own session — c6cb684
- [x] 2.4 GET /api/sessions/:id returns 404 for another user's session — c6cb684
- [x] 2.5 POST /api/sessions/:id/start flips queued → processing; returns { ok: true } — c6cb684
- [x] 2.6 POST /api/sessions/:id/start on already-processing session returns 409 — c6cb684

### Phase 3: Results Submission Endpoint

#### Automated

- [x] 3.1 npm run typecheck — passes
- [x] 3.2 npm run lint — passes

#### Manual

- [ ] 3.3 POST valid results payload to processing session → status completed, analysis_results row exists
- [ ] 3.4 POST error payload to processing session → status failed, error_message set
- [ ] 3.5 POST malformed payload → 400 with Zod error details
- [ ] 3.6 POST to queued (not started) session → 409
- [ ] 3.7 POST from different user for same session → 404
