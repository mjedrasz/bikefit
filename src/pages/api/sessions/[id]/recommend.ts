import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { createAdminClient } from "@/lib/services/supabase-admin";
import { checkRateLimit } from "@/lib/services/rate-limit";
import { generateRecommendations } from "@/lib/services/llm";
import { recommendRequestSchema } from "@/lib/schemas";
import { z } from "zod";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Cheapest rejection first (project convention — auth check is already here): reject an
  // over-limit caller before any DB ownership query or LLM call runs (test-plan §3 Phase 3,
  // Risk #3). Keyed on the server-resolved user id, never a client-suppliable value.
  const admin = createAdminClient();
  const rl = await checkRateLimit(admin, context.locals.user.id, "recommend");
  if (!rl.ok) {
    return Response.json({ error: "Could not verify request. Please try again." }, { status: 500 });
  }
  if (!rl.allowed) {
    return Response.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return new Response("Service unavailable", { status: 503 });
  }

  // `.maybeSingle()` so a genuine query failure (500) is distinguished from a missing/
  // not-owned row (404) — a query error is not "session not found" (project Risk #7).
  const { data: session, error } = await supabase
    .from("fitting_sessions")
    .select("id, status")
    .eq("id", context.params.id)
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

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = recommendRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: z.treeifyError(parsed.error) }, { status: 400 });
  }

  try {
    const result = await generateRecommendations(parsed.data.body_angles);
    return Response.json(result);
  } catch (err) {
    // eslint-disable-next-line no-console -- upstream detail stays server-side; caller gets a fixed string
    console.error("recommend LLM call failed", err);
    return Response.json({ error: "Could not generate recommendations. Please try again." }, { status: 500 });
  }
};
