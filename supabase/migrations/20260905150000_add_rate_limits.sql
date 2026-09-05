-- ─────────────────────────────────────────────────────────────────────────────
-- rate_limits: atomic per-user, per-route request counter (fixed 10-minute
-- windows, bucketed server-side by Postgres's own now() — not the app's clock)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE rate_limits (
    user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    route         TEXT        NOT NULL,
    window_start  TIMESTAMPTZ NOT NULL,
    request_count INT         NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, route, window_start)
);

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits FORCE ROW LEVEL SECURITY;

-- No policies for authenticated/anon. All access goes through
-- check_and_increment_rate_limit(), invoked exclusively via the service-role
-- admin client — mirrors analysis_results' "no policy = no direct access" pattern.

-- Atomic per-user/per-route counter. Computes its own window bucket from
-- now() rather than trusting a caller-supplied timestamp, so it stays
-- authoritative no matter which Worker instance handled the request.
CREATE OR REPLACE FUNCTION check_and_increment_rate_limit(
  p_user_id uuid,
  p_route text,
  p_window_minutes int DEFAULT 10
) RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  v_window_start timestamptz;
  v_count int;
BEGIN
  v_window_start := date_trunc('hour', now()) +
    (floor(date_part('minute', now()) / p_window_minutes)::int * (p_window_minutes || ' minutes')::interval);

  INSERT INTO rate_limits (user_id, route, window_start, request_count)
  VALUES (p_user_id, p_route, v_window_start, 1)
  ON CONFLICT (user_id, route, window_start)
  DO UPDATE SET request_count = rate_limits.request_count + 1
  RETURNING request_count INTO v_count;

  RETURN v_count;
END;
$$;
