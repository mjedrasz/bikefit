import type { APIRoute } from "astro";
import { createAdminClient } from "@/lib/services/supabase-admin";
import { createSessionSchema } from "@/lib/schemas";

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
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
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

  if (error || !data) {
    return Response.json({ error: "Failed to create session" }, { status: 500 });
  }

  return Response.json({ id: data.id, status: data.status }, { status: 201 });
};
