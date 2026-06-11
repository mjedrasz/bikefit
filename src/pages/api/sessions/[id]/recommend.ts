import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { generateRecommendations } from "@/lib/services/llm";
import { recommendRequestSchema } from "@/lib/schemas";
import { z } from "zod";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return new Response("Service unavailable", { status: 503 });
  }

  const { data } = await supabase.from("fitting_sessions").select("id").eq("id", context.params.id).single();

  if (!data) {
    return Response.json({ error: "Session not found" }, { status: 404 });
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
    return Response.json({ error: err instanceof Error ? err.message : "LLM call failed" }, { status: 500 });
  }
};
