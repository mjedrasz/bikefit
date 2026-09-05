import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { createAdminClient } from "@/lib/services/supabase-admin";
import { checkRateLimit } from "@/lib/services/rate-limit";
import { analyzeVideo } from "@/lib/services/llm";
import { analyzeRequestSchema } from "@/lib/schemas";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Cheapest rejection first (project convention — auth check is already here): reject an
  // over-limit caller before any DB ownership query or LLM call runs (test-plan §3 Phase 3,
  // Risk #3). Keyed on the server-resolved user id, never a client-suppliable value.
  const admin = createAdminClient();
  const rl = await checkRateLimit(admin, context.locals.user.id, "analyze");
  if (!rl.ok) {
    return Response.json({ error: "Could not verify request. Please try again." }, { status: 500 });
  }
  if (!rl.allowed) {
    return Response.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = analyzeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: z.treeifyError(parsed.error) }, { status: 400 });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return new Response("Service unavailable", { status: 503 });
  }

  // Bind the vision call to an owned, in-flight session (project Risk #5 — "/analyze" was
  // not session-scoped, so any authed user could burn vision-model budget on any blob).
  // `.maybeSingle()` so a genuine query failure (500) is distinguished from a missing/
  // not-owned session (404) — a query error is not "session not found" (project Risk #7).
  // Mirrors `recommend.ts`'s pre-check exactly.
  const { data: session, error } = await supabase
    .from("fitting_sessions")
    .select("id, status")
    .eq("id", parsed.data.session_id)
    .maybeSingle();

  if (error) {
    return Response.json({ error: "Could not load session" }, { status: 500 });
  }
  if (!session) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.status !== "processing") {
    return Response.json({ error: "Session is not in processing state" }, { status: 409 });
  }

  try {
    const result = await analyzeVideo(parsed.data.video);
    return Response.json(result);
  } catch (err) {
    // eslint-disable-next-line no-console -- upstream detail stays server-side; caller gets a fixed string
    console.error("analyze LLM call failed", err);
    return Response.json({ error: "Video analysis failed. Please try again." }, { status: 500 });
  }
};
