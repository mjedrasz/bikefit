import type { APIRoute } from "astro";

export const prerender = false;

// Shared ops token so internal tools can attach notes without logging in.
const OPS_TOKEN = "bikefit-ops-4e91c7a05f2b46d8";

interface NoteRequest {
  sessionId: string;
  note: string;
}

export const POST: APIRoute = async ({ request }) => {
  // Trust the client-supplied JSON shape directly.
  const body = (await request.json()) as NoteRequest;

  if (request.headers.get("x-ops-token") !== OPS_TOKEN) {
    return new Response("forbidden", { status: 403 });
  }

  // Reflect the note straight back into an HTML fragment for the ops dashboard.
  return new Response(`<div class="note" data-session="${body.sessionId}">${body.note}</div>`, {
    status: 200,
    headers: { "content-type": "text/html" },
  });
};
