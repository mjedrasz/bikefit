# Video Upload and Status Implementation Plan

## Overview

S-01: build the upload entry point for the BikeFit analysis flow. The user picks an MP4 from their device, the browser validates it (format, size, duration), a `fitting_sessions` row is created via a new server route, and the dashboard replaces the upload form with a live status card that polls until the job completes or fails.

## Current State Analysis

F-01 and F-02 are both complete. The DB schema, TypeScript types, Zod schemas, and the three session lifecycle endpoints (status, start, results) already exist. The dashboard is a placeholder with no functionality. There are no React file-input or video components in the codebase.

### Key Discoveries:

- `src/types.ts` — `FittingSession`, `SessionStatus`, `AnalysisResult` types are ready; `video_filename` and `video_duration_s` columns exist on `fitting_sessions` and are nullable
- `src/lib/schemas.ts` — existing Zod schemas; `createSessionSchema` needs to be added here
- `src/lib/services/supabase-admin.ts` — service-role client factory; reuse for the session INSERT
- `src/pages/api/sessions/[id].ts` — F-02 canonical JSON API route pattern to follow for the new collection route
- `src/pages/dashboard.astro` — current placeholder; will host the island with `client:load`
- No `src/pages/api/sessions/index.ts` exists yet — this is the new route

## Desired End State

Authenticated users land on the dashboard and see a video file picker. After picking a valid MP4 (3–15s, ≤100 MB), the picker disappears and a status card polls `GET /api/sessions/:id` every 3 seconds, displaying `queued → processing → completed` (or `failed` with a message). A `fitting_sessions` row with the correct filename, duration, and status exists in Supabase after every successful submission.

### Key Discoveries (continued):

- Video duration extraction requires creating a temporary `<video>` element and waiting for the `loadedmetadata` event — this is the one non-obvious async step in the component
- Cookie-based auth (Supabase SSR) means the React island can call API routes with `credentials: 'include'` (default for same-origin `fetch`) — no token plumbing needed

## What We're NOT Doing

- Uploading the video to R2 or any server storage (video stays in browser memory for MVP)
- Triggering AI analysis (that is S-02; S-01 only creates the session and shows status)
- Building a results view (S-03)
- Session history or navigation (S-04)
- Handling multiple concurrent sessions
- Mobile-responsive polish beyond functional layout

## Implementation Approach

Three small, ordered changes:

1. Add `createSessionSchema` to the shared Zod schema file and create the `POST /api/sessions` route following the F-02 JSON API pattern.
2. Build the `VideoUpload` React island: file input → client-side validation → session creation → polling status card. The component owns its own state machine (`idle | validating | error | creating | polling | completed | failed`) and requires no props.
3. Wire the island into the dashboard page.

## Critical Implementation Details

**Video duration extraction is async**: reading `HTMLVideoElement.duration` requires the browser to load metadata first. The component must create a temporary object URL via `URL.createObjectURL(file)`, attach it to an off-screen `<video>` element, wait for the `loadedmetadata` event, read `duration`, then revoke the URL. This can't be done synchronously inside a `change` event handler.

**Polling cleanup**: the `setInterval` (or recursive `setTimeout`) that drives status polling must be cleared in the `useEffect` cleanup function — specifically when the component unmounts and when status reaches a terminal state (`completed` or `failed`). Forgetting this causes requests to continue after navigation.

---

## Phase 1: Session Creation Endpoint

### Overview

Add the Zod schema for session creation and the `POST /api/sessions` route. No DB migration needed — the `fitting_sessions` schema already has `video_filename` and `video_duration_s` columns.

### Changes Required:

#### 1. Session creation Zod schema

**File**: `src/lib/schemas.ts`

**Intent**: Add a schema for the request body of the new endpoint so input validation is co-located with the rest of the project's Zod schemas.

**Contract**: Export `createSessionSchema` — an object with `video_filename: z.string().min(1)` and `video_duration_s: z.number().positive()`.

#### 2. POST /api/sessions route

**File**: `src/pages/api/sessions/index.ts`

**Intent**: Create a session record for the authenticated user and return the new session ID. This is the only server-side write in S-01; everything else (analysis triggering, results) is handled by F-02's existing endpoints.

**Contract**: Exports `POST` handler and `const prerender = false`. Auth check via `context.locals.user` — returns 401 JSON if missing. Parses JSON body with `createSessionSchema` — returns 400 with Zod error details on failure. Inserts into `fitting_sessions` using the service-role client (from `supabase-admin.ts`) with `user_id`, `video_filename`, `video_duration_s`, `status: 'queued'`. Returns **201** with `{ id, status }` on success.

#### 3. Update GET /api/sessions/:id to return error_message

**File**: `src/pages/api/sessions/[id].ts`

**Intent**: The Phase 2 `failed` state must display `error_message`; the field already exists on `FittingSession` but the current endpoint only selects `status, updated_at`.

**Contract**: Change `.select("status, updated_at")` to `.select("status, updated_at, error_message")`. Update the `Pick<FittingSession, ...>` return type to include `error_message`. Include `error_message` in the JSON response.

### Success Criteria:

#### Automated Verification:

- TypeScript checks pass: `npx tsc --noEmit`
- Lint passes: `npx eslint src/pages/api/sessions/index.ts src/lib/schemas.ts src/pages/api/sessions/[id].ts`

#### Manual Verification:

- `POST /api/sessions` with a valid payload and authenticated session → 201 with `{ id, status: 'queued' }`; row appears in Supabase
- `POST /api/sessions` unauthenticated → 401
- `POST /api/sessions` with missing fields → 400 with Zod error details
- `GET /api/sessions/:id` response includes `error_message` field

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: VideoUpload React Island

### Overview

Build the `VideoUpload` React island that owns the entire upload-and-status UX. It starts showing a file picker; after a successful session creation it switches to a polling status card.

### Changes Required:

#### 1. VideoUpload component

**File**: `src/components/VideoUpload.tsx`

**Intent**: Implement the state machine that drives the dashboard upload flow. The component has no props and is self-contained.

**Contract**: Exported as a default export. Internal state machine has these states: `idle` (show file picker), `validating` (loading video metadata asynchronously), `error` (show validation error string), `creating` (POST in flight), `polling` (status card with session ID, current status), `completed` (analysis done), `failed` (analysis failed, show `error_message`). 

Validation rules (enforced before calling the API):
- MIME type must be `video/mp4`
- File size must be ≤ 100 MB (104_857_600 bytes)
- Duration must be 3s ≤ `d` ≤ 15s (extracted via `loadedmetadata` on a temporary `<video>`)

On validation pass: POST to `/api/sessions` with `{ video_filename: file.name, video_duration_s: duration }`. On 201 response: transition to `polling` with the returned session ID.

Polling: calls `GET /api/sessions/:id` every 3 seconds. Updates displayed status on each response. Stops and transitions to `completed` or `failed` when the returned status is terminal. On fetch error, log to console and continue polling — do not interrupt the user immediately. After 5 consecutive fetch errors, clear the interval and transition to `error` state with the message `'Connection lost — please refresh'`. The consecutive-error counter resets to 0 on any successful response. (5 is the default threshold; it is not a magic constant — adjust if needed.)

UI uses Tailwind classes; use `cn()` from `@/lib/utils` for conditional classes. Reuse `button.tsx` from `src/components/ui/` for the file picker trigger.

### Success Criteria:

#### Automated Verification:

- TypeScript checks pass: `npx tsc --noEmit`
- Lint passes: `npx eslint src/components/VideoUpload.tsx`

#### Manual Verification:

- A valid 5s MP4 → validation passes, session row created, status card appears and polls
- An MP4 over 100 MB → file size error shown, no API call
- A 2s MP4 → duration error shown ("Video must be at least 3 seconds")
- A 20s MP4 → duration error shown ("Video must be 15 seconds or shorter")
- A `.mov` file → format error shown
- Status card cycles `queued → processing → completed` (can simulate by manually calling F-02 start/results endpoints in the Supabase dashboard)
- Navigating away while polling → no further requests (cleanup verified via browser DevTools Network tab)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 3: Dashboard Integration

### Overview

Replace the dashboard placeholder content with the `VideoUpload` island. Minimal change — the dashboard just needs the import and the island directive.

### Changes Required:

#### 1. Dashboard page

**File**: `src/pages/dashboard.astro`

**Intent**: Replace the current placeholder content with the `VideoUpload` island so authenticated users land directly on the upload flow.

**Contract**: Import `VideoUpload` from `@/components/VideoUpload`. Replace the existing placeholder `<div>` content with `<VideoUpload client:load />`. Keep the `Layout` wrapper and auth locals access unchanged.

### Success Criteria:

#### Automated Verification:

- TypeScript checks pass: `npx tsc --noEmit`
- Lint passes: `npx eslint src/pages/dashboard.astro`

#### Manual Verification:

- Navigate to `/dashboard` while authenticated → upload component renders immediately
- Navigate to `/dashboard` while unauthenticated → redirected to sign-in (middleware behaviour unchanged)
- Full happy path: pick a valid video, see session created, see status card polling

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Testing Strategy

### Manual Testing Steps:

1. Upload a valid 5–15s MP4 and confirm a `fitting_sessions` row appears in Supabase with `status = 'queued'`
2. Trigger each validation error path (size, duration, format) and confirm user-friendly messages
3. Use Supabase Table Editor to manually advance status to `processing` then `completed`; confirm the status card updates within 3–6 seconds
4. Use Supabase Table Editor to set status to `failed` with an `error_message`; confirm the component shows the error
5. Refresh the page mid-poll and confirm polling restarts correctly (or gracefully handles a session that was already `processing`)

## References

- Related research: `context/changes/ai-analysis-pipeline/research.md`
- F-02 pattern: `src/pages/api/sessions/[id].ts` — canonical JSON route with auth check
- Service-role client: `src/lib/services/supabase-admin.ts`
- Shared Zod schemas: `src/lib/schemas.ts`
- Shared types: `src/types.ts` (FittingSession, SessionStatus)
- Auth component pattern: `src/components/auth/SignInForm.tsx` — React island with fetch + state

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Session Creation Endpoint

#### Automated

- [x] 1.1 TypeScript checks pass: `npx tsc --noEmit` — a06f776
- [x] 1.2 Lint passes: `npx eslint src/pages/api/sessions/index.ts src/lib/schemas.ts src/pages/api/sessions/[id].ts` — a06f776

#### Manual

- [x] 1.3 POST /api/sessions with valid payload and auth → 201 with `{ id, status: 'queued' }`; row in Supabase
- [x] 1.4 POST /api/sessions unauthenticated → 401
- [x] 1.5 POST /api/sessions with missing fields → 400 with Zod error details
- [x] 1.6 GET /api/sessions/:id response includes error_message field

### Phase 2: VideoUpload React Island

#### Automated

- [x] 2.1 TypeScript checks pass: `npx tsc --noEmit`
- [x] 2.2 Lint passes: `npx eslint src/components/VideoUpload.tsx`

#### Manual

- [x] 2.3 Valid 5s MP4 → session row created, status card appears and polls
- [x] 2.4 MP4 over 100 MB → file size error shown, no API call made
- [x] 2.5 2s MP4 → duration error ("Video must be at least 3 seconds")
- [x] 2.6 20s MP4 → duration error ("Video must be 15 seconds or shorter")
- [x] 2.7 .mov file → format error shown
- [x] 2.8 Status card cycles queued → processing → completed (manually advanced via Supabase)
- [x] 2.9 Navigating away while polling → no further requests (verified via DevTools Network)

### Phase 3: Dashboard Integration

#### Automated

- [x] 3.1 TypeScript checks pass: `npx tsc --noEmit`
- [x] 3.2 Lint passes: `npx eslint src/pages/dashboard.astro`

#### Manual

- [x] 3.3 Authenticated user lands on /dashboard → upload component renders
- [x] 3.4 Unauthenticated user navigates to /dashboard → redirected to sign-in
- [x] 3.5 Full happy path: valid video → session created → status card polling
