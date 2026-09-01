# Database Schema and Privacy Design — Plan Brief

> Full plan: `context/changes/db-schema-and-privacy-design/plan.md`

## What & Why

Create the `fitting_sessions` and `analysis_results` tables in Supabase with row-level security and a privacy-first schema (no raw video column). This is F-01 — the foundation every other BikeFit slice depends on. A mistake here propagates to four downstream slices, so it ships before any other work begins.

## Starting Point

Supabase is configured and auth is fully wired, but no custom tables or migrations exist. `supabase/migrations/` doesn't exist yet. There are no TypeScript domain types defined.

## Desired End State

Two tables exist in Supabase with RLS enforced. Authenticated users can only read and create their own sessions; the pipeline worker (service role) handles all status updates and result writes. `video_r2_key` is the only video reference in the DB — it's nulled after the R2 object is deleted, satisfying the privacy NFR. `src/types.ts` exports typed interfaces for both tables that all downstream slices import.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
|---|---|---|
| R2 key after deletion | Null `video_r2_key` in DB | NULL is auditable proof the video is gone; a non-null key pointing to a deleted object is misleading |
| Session status type | TEXT + CHECK constraint | Easier to extend in future migrations than a native ENUM; string literals are simpler in TypeScript |
| Results storage | JSONB columns for recommendations and body_angles | The LLM selects which angles are relevant at runtime — JSONB handles variable-length output without schema churn |
| Video metadata | Store `video_filename` + `video_duration_s` | Session history (S-04) can display clip info after the R2 object is gone |
| LLM response | Store `raw_llm_response TEXT nullable` | Early-stage pipeline debugging requires access to the raw LLM output |
| Privacy audit | NULL key is the signal; no `video_deleted_at` timestamp | Simpler schema; `created_at` + `updated_at` give a time window; MVP doesn't need a dedicated audit field |
| Video deletion strategy | Two-layer: pipeline explicit delete + R2 lifecycle TTL safety net | Primary: pipeline NULLs key after R2 delete (immediate); safety net: R2 lifecycle rule expires orphans if pipeline crashes |
| TypeScript types | Manual in `src/types.ts` | Project convention; Supabase CLI type generation not used here |

## Scope

**In scope:**
- `supabase/migrations/20260526120000_initial_schema.sql` (tables, trigger, RLS policies)
- `src/types.ts` (entity interfaces and status union type)
- Local verification via `supabase db reset` and TypeScript type check

**Out of scope:**
- R2 lifecycle rule (F-02 infra step)
- Job queue columns/tables (F-02's schema additions)
- Video upload API route (S-01)
- `seed.sql`
- Supabase CLI type generation

## Architecture / Approach

One SQL migration file defines the complete schema. `fitting_sessions` (owned by `auth.users` via FK) tracks upload and job lifecycle; `analysis_results` (owned by `fitting_sessions` via FK) stores LLM output as JSONB. RLS policies enforce user isolation for reads and inserts; the pipeline worker uses the service role key and bypasses RLS for all writes. TypeScript interfaces in `src/types.ts` mirror the SQL schema exactly.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. SQL Migration | Both tables, trigger, RLS policies in one migration file | Wrong RLS policy allows cross-user reads or blocks service-role writes |
| 2. TypeScript Types | `src/types.ts` with all entity interfaces | Type drift from schema (field name or nullability mismatch) |
| 3. Local Verification | Migration applied and validated in local Supabase | Local Supabase not running; migration errors not caught until F-02 |

**Prerequisites:** Local Supabase running (`supabase start`)
**Estimated effort:** ~1 session; all three phases are straightforward with the SQL already designed

## Open Risks & Assumptions

- R2 lifecycle rule (safety net for video deletion) is not implemented in F-01 — F-02 must add it before S-01 goes live
- `raw_llm_response` will be dropped or made opt-in once the pipeline is stable (future migration)
- `FORCE ROW LEVEL SECURITY` is required alongside `ENABLE ROW LEVEL SECURITY` to block the `postgres` role in local dev — easy to miss

## Success Criteria (Summary)

- `supabase db reset` applies with zero errors and `supabase db diff` returns no unexpected changes
- `npm run typecheck` passes with the new types in place
- Supabase Studio shows three RLS policies and no raw video column on any table
