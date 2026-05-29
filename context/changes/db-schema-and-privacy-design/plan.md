# Database Schema and Privacy Design — Implementation Plan

## Overview

Create the initial BikeFit database schema: `fitting_sessions` and `analysis_results` tables with row-level security and privacy-first constraints, plus TypeScript entity types. This foundation unlocks every downstream slice (S-01, S-02, S-03, S-04) — a schema mistake here propagates to all four.

## Current State Analysis

- Supabase SDK is configured and auth is fully wired (`src/lib/supabase.ts`, `src/middleware.ts`)
- Auth uses `auth.users` (Supabase built-in) — user ownership FKs anchor here
- `supabase/migrations/` directory does not exist yet
- No custom tables or domain models exist
- `supabase/config.toml` has `[db.seed] enabled = true` with `sql_paths = ["./seed.sql"]` — file doesn't exist; Phase 1 creates an empty one so `supabase db reset` completes cleanly
- `src/types.ts` does not exist yet

## Desired End State

- `fitting_sessions` and `analysis_results` tables exist in Supabase with RLS enforced
- `supabase/migrations/20260526120000_initial_schema.sql` defines the complete schema, triggers, and RLS policies
- Authenticated users can read and insert only their own sessions; only the service-role pipeline can write results or update session status
- `src/types.ts` exports `SessionStatus`, `FittingSession`, `Recommendation`, `BodyAngle`, `AnalysisResult`
- No raw video column exists anywhere in the schema; `video_r2_key` is the only video reference and is nullable (nulled after R2 deletion)
- TypeScript type check passes with no errors

### Key Discoveries

- `auth.users` is Supabase's built-in users table — FK references must use `REFERENCES auth.users(id)`
- `supabase/config.toml` `schema_paths = []` — no schema auto-applied; migrations are the sole source of truth
- Service role bypasses RLS entirely — only `authenticated` (and optionally `anon`) policies need to be defined
- `FORCE ROW LEVEL SECURITY` must be set alongside `ENABLE ROW LEVEL SECURITY` to block the table owner (postgres role) from bypassing policies in local dev

## What We're NOT Doing

- No seed data in `seed.sql` — file is created empty solely to satisfy the Supabase CLI seed runner
- No R2 lifecycle policy — infra concern; document it as an F-02 prerequisite note, not implemented here
- No job queue columns/tables — F-02 extends this schema; don't add queue-specific columns now
- No Supabase CLI type generation — manual types in `src/types.ts` per project convention
- No video upload API route — S-01's concern
- No `bike_type` column — gravel-only is an MVP constraint enforced in application logic, not schema

## Implementation Approach

Single SQL migration file, then TypeScript types, then local verification. The migration is the load-bearing contract — all downstream slices read or write against it. Phase 1 produces the SQL file; Phase 2 produces the TS types; Phase 3 applies and validates locally.

A two-layer video deletion strategy is documented here but not implemented in this phase:
1. **Primary (F-02's job):** Pipeline worker explicitly deletes from R2 and NULLs `video_r2_key` in DB after analysis completes or fails.
2. **Safety net (F-02's job):** R2 lifecycle rule (e.g., 24-hour TTL on `uploads/` prefix) expires orphaned objects if the pipeline crashes. Does not require DB coordination.

---

## Phase 1: SQL Migration

### Overview

Create the `supabase/migrations/` directory and write the initial schema migration defining both tables, the `updated_at` trigger, RLS enablement, and per-operation policies for the `authenticated` role.

### Changes Required

#### 1. Empty seed file

**File**: `supabase/seed.sql`

**Intent**: `supabase/config.toml` has `[db.seed] enabled = true` with `sql_paths = ["./seed.sql"]`. Without this file, `supabase db reset` fails after applying migrations. Create an empty file so the reset command completes cleanly.

**Contract**: File must exist and be empty (or contain only a comment). Do not add actual seed data here.

```sql
-- seed.sql intentionally empty: no seed data required for this schema foundation
```

---

#### 2. Migration file

**File**: `supabase/migrations/20260526120000_initial_schema.sql`

**Intent**: Define the complete BikeFit schema — `fitting_sessions` (one row per user upload), `analysis_results` (one row per completed analysis), a trigger to keep `updated_at` current, and RLS policies that ensure authenticated users access only their own data.

**Contract**: The SQL below is the schema contract that all downstream slices depend on. Include it verbatim; do not alter column names or types without updating `src/types.ts` in Phase 2.

```sql
-- Helper: keep updated_at current on every row UPDATE
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- fitting_sessions: one row per upload/analysis attempt
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE fitting_sessions (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status           TEXT        NOT NULL DEFAULT 'queued'
                                 CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    video_r2_key     TEXT,          -- R2 object key; NULLed after video is deleted post-analysis
    video_filename   TEXT,          -- original filename for session history display
    video_duration_s NUMERIC(6,2), -- clip length in seconds
    error_message    TEXT,          -- populated when status = 'failed'
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON fitting_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE fitting_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fitting_sessions FORCE ROW LEVEL SECURITY;

CREATE POLICY "sessions_select_own"
    ON fitting_sessions FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "sessions_insert_own"
    ON fitting_sessions FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

-- No UPDATE or DELETE policy for authenticated role.
-- Status transitions and video_r2_key nulling are performed by the
-- pipeline worker via service_role, which bypasses RLS.

-- ─────────────────────────────────────────────────────────────────────────────
-- analysis_results: one row per completed analysis (service_role writes only)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE analysis_results (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id       UUID        NOT NULL REFERENCES fitting_sessions(id) ON DELETE CASCADE,
    recommendations  JSONB       NOT NULL DEFAULT '[]'::jsonb,
    body_angles      JSONB       NOT NULL DEFAULT '[]'::jsonb,
    raw_llm_response TEXT,          -- raw LLM output retained for pipeline debugging
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE analysis_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_results FORCE ROW LEVEL SECURITY;

CREATE POLICY "results_select_own"
    ON analysis_results FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM   fitting_sessions fs
            WHERE  fs.id      = session_id
            AND    fs.user_id = auth.uid()
        )
    );

-- No INSERT/UPDATE/DELETE policy for authenticated role.
-- All result writes are performed by the pipeline via service_role.

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes to support RLS policy lookups
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX ON fitting_sessions(user_id);    -- used by sessions_select_own and sessions_insert_own
CREATE INDEX ON analysis_results(session_id); -- used by results_select_own correlated subquery
```

**JSONB array item shapes (for implementer reference):**

`recommendations` items:
```json
{ "adjustment": "raise saddle ~5mm", "rationale": "knee angle 142° sits above ideal 140–150°" }
```

`body_angles` items:
```json
{ "name": "knee_angle", "value": 142, "reference_min": 140, "reference_max": 150, "unit": "deg" }
```

### Success Criteria

#### Automated Verification

- Migration applies cleanly: `supabase db reset` (or `supabase migration up`) exits with no errors
- Schema diff matches expected: `supabase db diff --schema public` shows both tables with correct columns

#### Manual Verification

- Supabase Studio (http://127.0.0.1:54323) → Table Editor shows `fitting_sessions` and `analysis_results` with expected columns and types
- RLS is shown as "enabled" on both tables in Supabase Studio → Authentication → Policies
- Policies list shows `sessions_select_own`, `sessions_insert_own`, `results_select_own` — no extra policies
- No column named `video` or `video_data` or any raw video field exists on any table

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation from the human that the manual testing was successful before proceeding to Phase 2. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: TypeScript Entity Types

### Overview

Create `src/types.ts` with entity types that exactly mirror the migration schema from Phase 1. These types are imported by S-01 (upload), S-02 (pipeline), S-03 (display), and S-04 (history) — keep them stable.

### Changes Required

#### 1. Create `src/types.ts`

**File**: `src/types.ts`

**Intent**: Export named TypeScript interfaces for `FittingSession` and `AnalysisResult`, a `SessionStatus` literal union, and JSONB item shapes (`Recommendation`, `BodyAngle`). All downstream slices import from here — no local type definitions in individual components.

**Contract**: Each field name and nullability must match the SQL migration exactly. `JSONB` columns map to typed arrays (not `Record<string, unknown>`). `TIMESTAMPTZ` maps to `string` (ISO 8601 from Supabase client).

```typescript
export type SessionStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface FittingSession {
  id: string;
  user_id: string;
  status: SessionStatus;
  video_r2_key: string | null;
  video_filename: string | null;
  video_duration_s: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface Recommendation {
  adjustment: string;
  rationale: string;
}

export interface BodyAngle {
  name: string;
  value: number;
  reference_min: number;
  reference_max: number;
  unit: string;
}

export interface AnalysisResult {
  id: string;
  session_id: string;
  recommendations: Recommendation[];
  body_angles: BodyAngle[];
  raw_llm_response: string | null;
  created_at: string;
}
```

### Success Criteria

#### Automated Verification

- TypeScript type check passes: `npm run typecheck` (or `npx tsc --noEmit`) exits with no errors

#### Manual Verification

- `src/types.ts` is the single source of truth — no inline type definitions for these entities exist elsewhere in `src/`

**Implementation Note**: After completing this phase and type check passes, pause for manual confirmation from the human before proceeding to Phase 3.

---

## Phase 3: Apply Migration and Validate Locally

### Overview

Apply the migration against the local Supabase instance and perform a final end-to-end schema check. This phase produces no new files — it validates that Phases 1 and 2 are consistent and the local DB reflects the intended schema.

### Changes Required

#### 1. Local Supabase instance

**File**: None — this is a runtime verification step.

**Intent**: Confirm the migration applies to a fresh local Supabase instance and that RLS blocks cross-user access. Use `supabase db reset` to apply from scratch.

**Contract**: The local Supabase API (default: http://127.0.0.1:54321) must reflect the schema from the migration. No manual schema edits — the migration file is the only source of truth.

### Success Criteria

#### Automated Verification

- `supabase db reset` applies with zero errors
- `supabase db diff --schema public` returns no diff (schema in DB matches migration)
- `npm run typecheck` passes (confirms TS types are consistent with Phase 2)

#### Manual Verification

- Attempt to insert a `fitting_sessions` row without `user_id` — DB rejects it (NOT NULL constraint)
- Attempt to insert a `fitting_sessions` row with a status outside the CHECK list — DB rejects it
- Verify no `video` or `video_data` column exists anywhere in Studio Table Editor
- Supabase Studio → Authentication → Policies: three policies visible (`sessions_select_own`, `sessions_insert_own`, `results_select_own`)
- Confirm `analysis_results` has no INSERT policy for `authenticated` role

**Implementation Note**: After all manual checks pass, this change is complete and F-01 is done. F-02 (`async-job-pipeline`) may now be started.

---

## Testing Strategy

### Automated

- Migration applies cleanly via `supabase db reset`
- `supabase db diff` produces no unexpected changes
- TypeScript type check passes

### Manual Testing Steps

1. `supabase start` then `supabase db reset` — confirm zero migration errors
2. Open Supabase Studio (http://127.0.0.1:54323) → Table Editor — verify both tables and all columns
3. Studio → Authentication → Policies — verify exactly three policies, all on correct tables
4. Try to insert a row via Studio SQL editor with an invalid status value — confirm CHECK constraint fires
5. `npx tsc --noEmit` from project root — confirm no type errors

## Migration Notes

- `supabase/migrations/` must be created as a new directory — the project currently has only `supabase/config.toml` and `supabase/.gitignore`
- `FORCE ROW LEVEL SECURITY` blocks the `postgres` role (table owner) from bypassing RLS in local dev — include it on both tables
- Service-role writes (pipeline in F-02) bypass RLS automatically — no service-role policies are needed
- The R2 lifecycle safety net (24-hour TTL on `uploads/` prefix) is an infrastructure step for F-02 to implement via `wrangler r2 bucket lifecycle`

## References

- Roadmap: `context/foundation/roadmap.md` (F-01 section)
- Infrastructure: `context/foundation/infrastructure.md` (R2 bucket `bikefit-uploads`, service-role secrets)
- PRD: `context/foundation/prd.md` (NFR-privacy, FR-001, FR-002)
- Supabase auth client: `src/lib/supabase.ts`
- CLAUDE.md: migration naming convention, RLS requirement, types location

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: SQL Migration

#### Automated

- [x] 1.1 `supabase db reset` applies cleanly with no errors — 680b2ad
- [x] 1.2 `supabase db diff --schema public` shows expected tables — 680b2ad

#### Manual

- [x] 1.3 Supabase Studio shows both tables with correct columns and types — 680b2ad
- [x] 1.4 RLS enabled on both tables; three policies visible, no extras — 680b2ad
- [x] 1.5 No raw video column exists on any table — 680b2ad

### Phase 2: TypeScript Entity Types

#### Automated

- [x] 2.1 `npm run typecheck` passes with no errors — b6cb511

#### Manual

- [x] 2.2 `src/types.ts` is sole source of truth for entity types; no inline duplicates in `src/` — b6cb511

### Phase 3: Apply Migration and Validate Locally

#### Automated

- [x] 3.1 `supabase db reset` applies with zero errors — 4db2a70
- [x] 3.2 `supabase db diff --schema public` returns no diff — 4db2a70
- [x] 3.3 `npm run typecheck` passes — 4db2a70

#### Manual

- [x] 3.4 Insert without `user_id` rejected by NOT NULL constraint — 4db2a70
- [x] 3.5 Invalid status value rejected by CHECK constraint — 4db2a70
- [x] 3.6 No `video` or `video_data` column exists in Studio Table Editor — 4db2a70
- [x] 3.7 Three policies visible in Studio (sessions_select_own, sessions_insert_own, results_select_own) — 4db2a70
- [x] 3.8 `analysis_results` has no INSERT policy for `authenticated` role — 4db2a70
