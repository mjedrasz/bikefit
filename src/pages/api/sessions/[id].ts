import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { createAdminClient } from "@/lib/services/supabase-admin";
import type { FittingSession } from "@/types";

export const prerender = false;

export const GET: APIRoute = async (context) => {
  if (!context.locals.user) {
    return new Response(null, { status: 401 });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return new Response("Service unavailable", { status: 503 });
  }

  const { data } = await supabase
    .from("fitting_sessions")
    .select("status, updated_at, error_message")
    .eq("id", context.params.id)
    .single();

  if (!data) {
    return new Response(null, { status: 404 });
  }

  const session = data as Pick<FittingSession, "status" | "updated_at" | "error_message">;
  return Response.json({
    status: session.status,
    updated_at: session.updated_at,
    error_message: session.error_message,
  });
};

export const DELETE: APIRoute = async (context) => {
  if (!context.locals.user) {
    return new Response(null, { status: 401 });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return new Response("Service unavailable", { status: 503 });
  }

  // Ownership pre-check: RLS (sessions_select_own) scopes this to the owner, so
  // another user's row comes back as `!data` → 404 (no owner-enumeration leak).
  // `.maybeSingle()` (not `.single()`) returns `data: null` with no `error` for
  // the not-found / not-owner case, so a populated `error` means the query
  // genuinely failed — surface that as 500 rather than letting it read as
  // "row absent" (project Risk #7).
  const { data, error } = await supabase
    .from("fitting_sessions")
    .select("id")
    .eq("id", context.params.id)
    .maybeSingle();

  if (error) {
    return new Response(null, { status: 500 });
  }
  if (!data) {
    return new Response(null, { status: 404 });
  }

  // Delete via the admin (service_role) client so the analysis_results cascade
  // runs unimpeded. The explicit `.eq("user_id", …)` is a belt-and-braces
  // ownership guard on top of the pre-check — RLS write policies have failed in
  // this SSR context before, so the route does not lean on sessions_delete_own.
  const admin = createAdminClient();
  const { data: deleted, error: deleteError } = await admin
    .from("fitting_sessions")
    .delete()
    .eq("id", context.params.id)
    .eq("user_id", context.locals.user.id)
    .select("id");

  if (deleteError) {
    return new Response(null, { status: 500 });
  }

  // supabase-js infers `data` as `null` for a string `.select()` on the admin
  // client (see the workaround comment in sessions/index.ts), so count the
  // affected rows through `unknown`. Zero rows → already deleted or a race → 404.
  const rows: unknown = deleted;
  if (!Array.isArray(rows) || rows.length === 0) {
    return new Response(null, { status: 404 });
  }

  return Response.json({ ok: true });
};
