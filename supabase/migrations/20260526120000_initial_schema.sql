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
