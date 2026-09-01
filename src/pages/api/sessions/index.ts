import type { APIRoute } from "astro";
import { createAdminClient } from "@/lib/services/supabase-admin";
import { createSessionSchema } from "@/lib/schemas";
import type { FittingSession } from "@/types";
import { z } from "zod";

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

  const parsed = createSessionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: z.treeifyError(parsed.error) }, { status: 400 });
  }

  const { video_filename, video_duration_s } = parsed.data;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("fitting_sessions")
    .insert({
      user_id: context.locals.user.id,
      video_filename,
      video_duration_s,
      status: "queued",
    })
    .select("id, status")
    .single();

  if (error) {
    return Response.json({ error: "Failed to create session" }, { status: 500 });
  }

  const session = data as Pick<FittingSession, "id" | "status">;
  return Response.json({ id: session.id, status: session.status }, { status: 201 });
};
