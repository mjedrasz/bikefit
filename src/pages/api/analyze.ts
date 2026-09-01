import type { APIRoute } from "astro";
import { z } from "zod";
import { analyzeVideo } from "@/lib/services/llm";
import { analyzeRequestSchema } from "@/lib/schemas";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
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

  try {
    const result = await analyzeVideo(parsed.data.video);
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "LLM call failed" }, { status: 500 });
  }
};
