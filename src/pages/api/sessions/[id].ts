import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
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
  return Response.json({ status: session.status, updated_at: session.updated_at, error_message: session.error_message });
};
