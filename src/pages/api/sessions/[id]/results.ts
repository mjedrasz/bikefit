import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { createAdminClient } from "@/lib/services/supabase-admin";
import { resultsPayloadSchema } from "@/lib/schemas";
import type { FittingSession } from "@/types";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return new Response(null, { status: 401 });
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return new Response(null, { status: 400 });
  }

  const result = resultsPayloadSchema.safeParse(body);
  if (!result.success) {
    return Response.json({ error: "Invalid payload", details: z.treeifyError(result.error) }, { status: 400 });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return new Response("Service unavailable", { status: 503 });
  }

  const { data } = await supabase.from("fitting_sessions").select("id, status").eq("id", context.params.id).single();

  if (!data) {
    return new Response(null, { status: 404 });
  }

  const session = data as Pick<FittingSession, "id" | "status">;
  if (session.status !== "processing") {
    return Response.json({ error: "Session is not in processing state" }, { status: 409 });
  }

  const admin = createAdminClient();
  const payload = result.data;

  if (!payload.error) {
    const { error: insertError } = await admin.from("analysis_results").insert({
      session_id: context.params.id,
      recommendations: payload.recommendations,
      body_angles: payload.body_angles,
      raw_llm_response: payload.raw_llm_response ?? null,
    });

    if (insertError) {
      return new Response(null, { status: 500 });
    }

    await admin.from("fitting_sessions").update({ status: "completed" }).eq("id", context.params.id);
  } else {
    await admin
      .from("fitting_sessions")
      .update({ status: "failed", error_message: payload.error_message })
      .eq("id", context.params.id);
  }

  return Response.json({ ok: true });
};
