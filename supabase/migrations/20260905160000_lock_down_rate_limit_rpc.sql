-- ─────────────────────────────────────────────────────────────────────────────
-- check_and_increment_rate_limit is meant to be reachable only via the
-- service-role admin client (see 20260905150000_add_rate_limits.sql). Postgres
-- grants EXECUTE on new functions to PUBLIC by default, so anon/authenticated
-- could call it directly via PostgREST — RLS on rate_limits blocks the
-- resulting write today, but that's a second, independent gate the function's
-- own privileges shouldn't need to rely on. Lock EXECUTE down explicitly.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION check_and_increment_rate_limit(uuid, text, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION check_and_increment_rate_limit(uuid, text, int) FROM anon;
REVOKE EXECUTE ON FUNCTION check_and_increment_rate_limit(uuid, text, int) FROM authenticated;
GRANT EXECUTE ON FUNCTION check_and_increment_rate_limit(uuid, text, int) TO service_role;

-- Not also pinning `search_path` here: the function body references
-- `rate_limits` unqualified, so `SET search_path = ''` breaks it at call time
-- (verified locally). Fixing that would mean schema-qualifying the table
-- inside the function body — a separate, larger change than this lock-down.
