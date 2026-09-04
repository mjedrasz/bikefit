import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { createAdminClient } from "@/lib/services/supabase-admin";
import type { FittingSession } from "@/types";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return new Response(null, { status: 401 });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return new Response("Service unavailable", { status: 503 });
  }

  // `.maybeSingle()` so a genuine query failure surfaces as its own `error` instead of
  // being indistinguishable from "row absent" (project Risk #7).
  const { data, error } = await supabase
    .from("fitting_sessions")
    .select("id, status")
    .eq("id", context.params.id)
    .maybeSingle();

  if (error) {
    return new Response(null, { status: 500 });
  }
  if (!data) {
    return new Response(null, { status: 404 });
  }

  const session = data as Pick<FittingSession, "id" | "status">;
  if (session.status !== "queued") {
    return Response.json({ error: "Session is not in queued state" }, { status: 409 });
  }

  const admin = createAdminClient();
  // Belt-and-braces ownership guard (project Risk #5): the RLS pre-check above is the
  // primary guard, but the admin (service-role) write bypasses RLS entirely, so it carries
  // its own `.eq("user_id", …)` in case the pre-check were ever refactored away or failed
  // open — mirrors the hardened `DELETE [id]` pattern. Result-checking (silent-failure →
  // 500) lands in §3 Phase 5.
  await admin
    .from("fitting_sessions")
    .update({ status: "processing" })
    .eq("id", context.params.id)
    .eq("user_id", context.locals.user.id);

  return Response.json({ ok: true });
};
