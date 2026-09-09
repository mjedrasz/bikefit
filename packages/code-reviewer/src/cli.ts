#!/usr/bin/env node
import { parseArgs } from "node:util";
import path from "node:path";
import process from "node:process";
import { createReviewer } from "./reviewer.js";
import { formatReview } from "./format.js";
import { ReviewParseError } from "./reviewer.js";

// Load .env from the current working directory if present (no dependency needed).
try {
  process.loadEnvFile();
} catch {
  // no .env file — fall back to the real environment
}

const USAGE = `code-reviewer — agent-based code review on OpenRouter

Usage:
  code-reviewer [options] <file...>

Options:
  --root <dir>       Directory the agent may read from   (default: cwd)
  --model <slug>     OpenRouter model slug                (default: $CODE_REVIEWER_MODEL
                                                           or anthropic/claude-sonnet-4.5)
  --context <text>   Extra context (diff, PR body, ticket)
  --max-steps <n>    Max agent tool round-trips           (default: 12)
  --json             Print the raw JSON review
  -h, --help         Show this help

Environment:
  OPENROUTER_API_KEY   required — https://openrouter.ai/keys

Exit codes:
  0  approve / comment      1  request_changes (or error)      2  bad usage / missing key
`;

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      root: { type: "string" },
      model: { type: "string" },
      context: { type: "string" },
      "max-steps": { type: "string" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  if (positionals.length === 0) {
    process.stderr.write(USAGE);
    return 2;
  }

  if (!process.env.OPENROUTER_API_KEY) {
    process.stderr.write(
      "error: OPENROUTER_API_KEY is not set. Copy .env.example to .env and add your key.\n",
    );
    return 2;
  }

  const rootDir = path.resolve(values.root ?? process.cwd());
  const files = positionals.map(
    (file) => path.relative(rootDir, path.resolve(file)) || path.basename(file),
  );

  const reviewer = createReviewer({
    model: values.model,
    maxSteps: values["max-steps"] ? Number(values["max-steps"]) : undefined,
  });

  process.stderr.write(
    `Reviewing ${files.length} file(s) with ${reviewer.model}…\n`,
  );

  const review = await reviewer.review({
    rootDir,
    files,
    context: values.context,
  });

  process.stdout.write(
    values.json
      ? `${JSON.stringify(review, null, 2)}\n`
      : `${formatReview(review)}\n`,
  );

  return review.verdict === "request_changes" ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    if (error instanceof ReviewParseError) {
      process.stderr.write(
        `${error.message}\n\n--- raw response ---\n${error.rawResponse}\n`,
      );
    } else {
      process.stderr.write(
        `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      );
    }
    process.exit(1);
  });
