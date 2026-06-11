# Video Upload and Status — Plan Brief

> Full plan: `context/changes/video-upload-and-status/plan.md`
> Research: `context/changes/ai-analysis-pipeline/research.md`

## What & Why

S-01 builds the entry point of the BikeFit analysis flow: the user picks an MP4, the app validates it, creates a fitting session, and shows a live status indicator while the job progresses. Without this slice, S-02 (the AI pipeline) has nowhere to route work — S-01 is the gate between "user has a video" and "system is processing it."

## Starting Point

F-01 and F-02 are both complete. The `fitting_sessions` table (with `video_filename`, `video_duration_s`, `status` columns), TypeScript types, Zod schemas, and the three session lifecycle endpoints (`GET /sessions/:id`, `POST /sessions/:id/start`, `POST /sessions/:id/results`) all exist. The dashboard is a placeholder with no functionality and no React file-input components exist in the codebase.

## Desired End State

An authenticated user lands on the dashboard, sees a video file picker, and submits a valid MP4. The form is replaced by a status card that polls every 3 seconds and advances through `queued → processing → completed` (or `failed`). A `fitting_sessions` row with the filename, duration, and correct status exists in Supabase for every successful submission.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Video storage (MVP) | Browser-only — no R2 | Browser is the pipeline worker per F-02; R2 deferred to production | Research / F-02 |
| Session creation | POST /api/sessions server route | Keeps service_role key off client; consistent with F-02 JSON API pattern | Plan |
| Duration limits | 3s min / 15s max | 3s covers ~3 crank revolutions; 15s cap keeps the frame batch small for S-02 | Plan |
| File size limit | 100 MB | Natural ceiling given Cloudflare Workers 100 MB request body limit | Plan |
| Status UX | Stay on dashboard, poll inline | No extra page; matches the polling contract F-02 already built | Plan |
| UI placement | Dashboard inline (replaces placeholder) | Single-page flow; dashboard has no other content for MVP | Plan |

## Scope

**In scope:**
- `createSessionSchema` added to `src/lib/schemas.ts`
- `POST /api/sessions` — session creation endpoint
- `src/components/VideoUpload.tsx` — React island with file picker, validation, session creation, and polling status card
- Dashboard integration: `<VideoUpload client:load />` replaces placeholder

**Out of scope:**
- Video upload to R2 or any server storage
- Triggering AI analysis (S-02)
- Results display (S-03)
- Session history (S-04)
- Multiple concurrent sessions

## Architecture / Approach

The component is a self-contained React island (no props) with a seven-state machine: `idle → validating → error | creating → polling → completed | failed`. Duration extraction is the one non-obvious step — it requires loading video metadata in the browser before the API call. Polling uses a `setInterval` cleaned up on unmount and on terminal state. The server route follows the F-02 JSON API pattern exactly: auth check, Zod parse, service-role INSERT, JSON response.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Session creation endpoint | `POST /api/sessions` — creates a queued session row | Route coexistence: `index.ts` alongside `[id].ts` is standard Astro but untested here |
| 2. VideoUpload React island | File picker + validation + polling status card | Async duration extraction pattern is easy to get wrong; polling cleanup must be verified |
| 3. Dashboard integration | Upload component live on `/dashboard` | Trivial; risk is low |

**Prerequisites:** F-01 complete (done), F-02 complete (done). No new env vars, no new migrations.  
**Estimated effort:** ~1 session across 3 phases.

## Open Risks & Assumptions

- Duration extraction via `loadedmetadata` is reliable on desktop browsers; behaviour on mobile Safari with large files may differ — acceptable for MVP
- The two-step validation (client-side duration check + server-side Zod check) has a gap: server does not re-validate duration against the 3–15s rule, relying on the client; acceptable for MVP
- Status polling will show `queued` indefinitely until S-02 is implemented to actually advance the status — this is expected and the card should communicate it clearly

## Success Criteria (Summary)

- A valid 5–15s MP4 produces a `fitting_sessions` row with `status = 'queued'` and a polling status card on the dashboard
- All four validation error paths (format, size, min duration, max duration) show user-friendly messages without making an API call
- The status card updates correctly when the session status is manually advanced in Supabase
