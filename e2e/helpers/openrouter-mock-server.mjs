// Stand-in for https://openrouter.ai/api/v1/chat/completions during e2e runs (plan §Phase 3).
//
// A Node-level `undici.setGlobalDispatcher` mock (src/test/helpers/openrouter-mock.ts) cannot
// reach the workerd `astro preview` sandbox — it has its own fetch. So the e2e path redirects
// the call here via `OPENROUTER_BASE_URL` (llm.ts). Both llm.ts calls hit the identical URL,
// so this server has no path-based way to tell the vision and text requests apart — it
// branches on the parsed request body's `model` field. Anything unrecognized is a hard 500
// (fail loud on drift — plan §Definitions), never a silently wrong-shaped 200.
//
// Plain `node:http`, no dependency — kept trivial on purpose.

import { createServer } from "node:http";
import process from "node:process";

const PORT = 4319;
const VISION_MODEL = "google/gemini-3.5-flash";
const TEXT_MODEL = "google/gemini-2.5-flash";

// Canned vision reply: two keyframes inside the committed fixture's real ~2.81s duration.
// These offsets are a best-guess starting point — Phase 4 tunes them against real (unmocked)
// CPU pose detection on the fixture, which needs >= 2 computable angles.
const VISION_CONTENT = JSON.stringify({
  timestamps: [
    { t: 1.0, f: 30, type: "BDC" },
    { t: 2.0, f: 60, type: "TDC" },
  ],
});

// Canned recommendations reply: one corrective item + the required `raw_llm_response` string,
// matching `recommendationSchema` / `generateRecommendations`'s expected envelope shape.
const RECOMMENDATIONS_CONTENT = JSON.stringify({
  recommendations: [
    {
      adjustment: "Raise saddle 4 mm",
      rationale: "Knee angle at BDC sits below the reference range; ~1 mm of saddle height per degree closes the gap.",
    },
  ],
  raw_llm_response: "e2e mock: knee angle at BDC is below range, one saddle-height correction returned.",
});

/**
 * @param {string} content
 * @returns {string} the OpenRouter chat-completions envelope wrapping `content`
 */
function envelope(content) {
  return JSON.stringify({ choices: [{ message: { content } }] });
}

/**
 * @param {import("node:http").ServerResponse} res
 * @param {number} status
 * @param {string} body
 * @returns {void}
 */
function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" }).end(body);
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @returns {Promise<string>} the full request body, decoded as UTF-8
 */
function readBody(req) {
  req.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    /** @type {string[]} */
    const parts = [];
    req.on("data", (chunk) => {
      parts.push(typeof chunk === "string" ? chunk : "");
    });
    req.on("end", () => {
      resolve(parts.join(""));
    });
    req.on("error", reject);
  });
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @returns {Promise<void>}
 */
async function handle(req, res) {
  if (req.method !== "POST") {
    send(res, 405, '{"error":"method not allowed"}');
    return;
  }

  const raw = await readBody(req);

  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    send(res, 400, '{"error":"invalid JSON body"}');
    return;
  }

  const model =
    typeof parsed === "object" && parsed !== null && "model" in parsed && typeof parsed.model === "string"
      ? parsed.model
      : "";

  if (model === VISION_MODEL) {
    send(res, 200, envelope(VISION_CONTENT));
    return;
  }
  if (model === TEXT_MODEL) {
    send(res, 200, envelope(RECOMMENDATIONS_CONTENT));
    return;
  }

  send(res, 500, JSON.stringify({ error: `openrouter-mock: unexpected model "${model || "(none)"}"` }));
}

const server = createServer((req, res) => {
  handle(req, res).catch(() => {
    if (!res.headersSent) send(res, 500, '{"error":"mock server error"}');
  });
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`openrouter-mock listening on http://127.0.0.1:${PORT}\n`);
});
