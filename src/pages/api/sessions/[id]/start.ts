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
  await admin.from("fitting_sessions").update({ status: "processing" }).eq("id", context.params.id);

  return Response.json({ ok: true });
};
