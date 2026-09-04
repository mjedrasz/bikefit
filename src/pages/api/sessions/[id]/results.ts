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
  if (session.status !== "processing") {
    return Response.json({ error: "Session is not in processing state" }, { status: 409 });
  }

  const admin = createAdminClient();
  const payload = result.data;

  if (!payload.error) {
    // `analysis_results` has no `user_id` column; the RLS pre-check above (which already
    // proved `context.params.id` belongs to `context.locals.user`) plus the FK to a now
    // ownership-guarded `fitting_sessions` row is the ownership guarantee here.
    const { error: insertError } = await admin.from("analysis_results").insert({
      session_id: context.params.id,
      recommendations: payload.recommendations,
      body_angles: payload.body_angles,
      raw_llm_response: payload.raw_llm_response ?? null,
    });

    if (insertError) {
      return new Response(null, { status: 500 });
    }

    // Belt-and-braces ownership guard (project Risk #5), mirroring `start.ts` / `DELETE
    // [id]`. Result-checking (silent-failure → 500) lands in §3 Phase 5.
    await admin
      .from("fitting_sessions")
      .update({ status: "completed" })
      .eq("id", context.params.id)
      .eq("user_id", context.locals.user.id);
  } else {
    await admin
      .from("fitting_sessions")
      .update({ status: "failed", error_message: payload.error_message })
      .eq("id", context.params.id)
      .eq("user_id", context.locals.user.id);
  }

  return Response.json({ ok: true });
};
