-- Forward-compatible DDL: grant the authenticated role permission to delete its
-- own fitting_sessions rows. The delete-session route deletes through the admin
-- (service_role) client after an RLS SELECT ownership pre-check and never
-- exercises this policy — it is shipped to satisfy roadmap S-06's "enforced by
-- RLS, not just the UI" directive and to be ready if a later change adopts a
-- user-client delete. (Mirrors how sessions_insert_own went inert after the
-- SSR JWT-propagation failure in the ai-analysis-pipeline change.)
--
-- No policy on analysis_results: its rows are removed by the
-- ON DELETE CASCADE on analysis_results.session_id, which runs under the
-- RLS-bypassing admin delete. The fitting_sessions(user_id) index added in
-- 20260526120000_initial_schema.sql backs the USING predicate.

CREATE POLICY "sessions_delete_own"
    ON fitting_sessions FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);
