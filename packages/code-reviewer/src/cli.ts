#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { createReviewer, ReviewParseError } from "./reviewer.js";
import { decide } from "./decide.js";
import { formatReviewMarkdown, formatReviewTerminal } from "./format.js";

// Load .env from the current working directory if present (no dependency needed).
try {
  process.loadEnvFile();
} catch {
  // no .env file — fall back to the real environment
}

const DEFAULT_MODEL =
  process.env.CODE_REVIEWER_MODEL ?? "anthropic/claude-sonnet-4.5";

const USAGE = `code-reviewer — single-call PR review on OpenRouter

Usage:
  code-reviewer --diff <text> [options]
  code-reviewer --diff-file <path> [options]

Options:
  --pr-title <text>         PR title (drives the pr_clarity criterion)
  --pr-description <text>    PR description / body
  --diff <text>             Unified diff to review        (exactly one of --diff
  --diff-file <path>          or --diff-file is required)
  --model <slug>            OpenRouter model slug         (default: $CODE_REVIEWER_MODEL
                                                           or anthropic/claude-sonnet-4.5)
  --fail-below <n>          Fail if any criterion scores below n, integer 1..10  (default: 5)
  --max-output-tokens <n>   Generation ceiling            (default: 8000)
  --max-cost <dollars>      Passed to stopWhen; inert for a single call  (default: 0.5)
  --max-tokens <n>          Passed to stopWhen; inert for a single call  (default: 200000)
  --timeout-ms <n>          Wall-clock deadline for the call             (default: 300000)
  --format <fmt>            terminal | markdown | json    (default: markdown)
  --out <path>              Also write the JSON result to this path
  -h, --help                Show this help

Environment:
  OPENROUTER_API_KEY   required — https://openrouter.ai/keys
  CODE_REVIEWER_MODEL  optional — overrides the default model slug

Exit codes:
  0  review completed — decision: pass
  1  review completed — decision: fail (a criterion scored below --fail-below)
  2  bad usage / missing OPENROUTER_API_KEY
  3  infra error — parse failure, SDK/network error, timeout, empty diff
`;

interface ErrorOut {
  decision: "error";
  error: string;
  model: string;
}

function writeErrorFile(
  outPath: string | undefined,
  model: string,
  message: string,
): void {
  if (outPath === undefined) {
    return;
  }
  const payload: ErrorOut = { decision: "error", error: message, model };
  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
}

function toNumber(raw: string | undefined, fallback: number): number {
  return raw === undefined ? fallback : Number(raw);
}

async function main(): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      allowPositionals: false,
      options: {
        "pr-title": { type: "string" },
        "pr-description": { type: "string" },
        diff: { type: "string" },
        "diff-file": { type: "string" },
        model: { type: "string" },
        "fail-below": { type: "string" },
        "max-output-tokens": { type: "string" },
        "max-cost": { type: "string" },
        "max-tokens": { type: "string" },
        "timeout-ms": { type: "string" },
        format: { type: "string" },
        out: { type: "string" },
        help: { type: "boolean", short: "h", default: false },
      },
    }));
  } catch (error) {
    process.stderr.write(
      `error: ${error instanceof Error ? error.message : String(error)}\n\n`,
    );
    process.stderr.write(USAGE);
    return 2;
  }

  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const model = values.model ?? DEFAULT_MODEL;
  const outPath = values.out;

  const hasDiff = values.diff !== undefined;
  const hasDiffFile = values["diff-file"] !== undefined;
  if (hasDiff === hasDiffFile) {
    process.stderr.write(
      "error: exactly one of --diff or --diff-file is required\n\n",
    );
    process.stderr.write(USAGE);
    return 2;
  }

  const failBelow = toNumber(values["fail-below"], 5);
  if (!Number.isInteger(failBelow) || failBelow < 1 || failBelow > 10) {
    process.stderr.write("error: --fail-below must be an integer in 1..10\n");
    return 2;
  }

  const format = values.format ?? "markdown";
  if (format !== "terminal" && format !== "markdown" && format !== "json") {
    process.stderr.write(
      "error: --format must be one of: terminal, markdown, json\n",
    );
    return 2;
  }

  if (!process.env.OPENROUTER_API_KEY) {
    process.stderr.write(
      "error: OPENROUTER_API_KEY is not set. Copy .env.example to .env and add your key.\n",
    );
    writeErrorFile(outPath, model, "OPENROUTER_API_KEY is not set");
    return 2;
  }

  let diff: string;
  try {
    diff = hasDiff
      ? (values.diff as string)
      : readFileSync(values["diff-file"] as string, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`error: could not read --diff-file: ${message}\n`);
    writeErrorFile(outPath, model, `could not read --diff-file: ${message}`);
    return 3;
  }

  const reviewer = createReviewer({
    model: values.model,
    maxOutputTokens: toNumber(values["max-output-tokens"], 8_000),
    timeoutMs: toNumber(values["timeout-ms"], 300_000),
    maxCostUsd: toNumber(values["max-cost"], 0.5),
    maxTokens: toNumber(values["max-tokens"], 200_000),
  });

  process.stderr.write(`Reviewing with ${reviewer.model}…\n`);

  let review;
  let usage;
  try {
    ({ review, usage } = await reviewer.review({
      prTitle: values["pr-title"] ?? "",
      prDescription: values["pr-description"] ?? "",
      diff,
    }));
  } catch (error) {
    if (error instanceof ReviewParseError) {
      process.stderr.write(
        `${error.message}\n\n--- raw response ---\n${error.rawResponse}\n`,
      );
      writeErrorFile(outPath, reviewer.model, error.message);
      return 3;
    }
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? message) : message}\n`,
    );
    writeErrorFile(outPath, reviewer.model, message);
    return 3;
  }

  const decision = decide(review, failBelow);

  const rendered =
    format === "json"
      ? JSON.stringify(
          {
            decision: decision.decision,
            failBelow: decision.failBelow,
            minScore: decision.minScore,
            failing: decision.failing,
            summary: review.summary,
            assessment: review.assessment,
            criteria: review.criteria,
            usage,
            model: reviewer.model,
          },
          null,
          2,
        )
      : format === "terminal"
        ? formatReviewTerminal(review, decision, usage, reviewer.model)
        : formatReviewMarkdown(review, decision, usage, reviewer.model);

  process.stdout.write(`${rendered}\n`);

  if (outPath !== undefined) {
    const payload = {
      decision: decision.decision,
      failBelow: decision.failBelow,
      minScore: decision.minScore,
      failing: decision.failing,
      summary: review.summary,
      assessment: review.assessment,
      criteria: review.criteria,
      usage,
      model: reviewer.model,
    };
    writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
  }

  return decision.decision === "pass" ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exit(3);
  });
