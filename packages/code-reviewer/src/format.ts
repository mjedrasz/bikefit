import {
  CRITERION_GROUPS,
  CRITERION_IDS,
  CRITERION_LABELS,
  type CriterionNote,
  type Review,
} from "./schemas.js";
import type { Decision } from "./decide.js";
import type { ReviewUsage } from "./reviewer.js";

/** Collapse whitespace so a rationale fits one table cell / one line. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** `file:line`, `file`, `line N`, or "" — whatever the note actually carries. */
function noteLocation(note: CriterionNote): string {
  if (note.file === "") {
    return note.line === null ? "" : `line ${note.line}`;
  }
  return note.line === null ? note.file : `${note.file}:${note.line}`;
}

function header(decision: Decision): string {
  return decision.decision === "pass"
    ? "AI code review — PASS"
    : `AI code review — FAIL (min ${decision.minScore} < fail-below ${decision.failBelow})`;
}

function footer(usage: ReviewUsage, model: string): string {
  const parts = [
    model,
    `${usage.modelCalls} model call(s)`,
    `~${usage.totalTokens} tokens`,
  ];
  if (usage.cost !== undefined) {
    parts.push(`$${usage.cost.toFixed(4)}`);
  }
  return parts.join(" · ");
}

/**
 * GitHub-flavoured Markdown for the Actions job log and the run summary: a
 * PASS / FAIL header, the one-line summary, the general assessment, a 5-row
 * score table, a `<details>` block per criterion that has notes, and a footer
 * with model + cost.
 */
export function formatReviewMarkdown(
  review: Review,
  decision: Decision,
  usage: ReviewUsage,
  model: string,
): string {
  const lines: string[] = [
    `**${header(decision)}**`,
    "",
    review.summary,
    "",
    review.assessment,
    "",
    "| Criterion | Group | Score | Rationale |",
    "| --- | --- | --- | --- |",
  ];

  for (const id of CRITERION_IDS) {
    const c = review.criteria[id];
    lines.push(
      `| ${CRITERION_LABELS[id]} | ${CRITERION_GROUPS[id]} | ${c.score}/10 | ${oneLine(
        c.rationale,
      )} |`,
    );
  }
  lines.push("");

  for (const id of CRITERION_IDS) {
    const c = review.criteria[id];
    if (c.notes.length === 0) {
      continue;
    }
    lines.push("<details>");
    lines.push(
      `<summary>${CRITERION_LABELS[id]} — ${c.notes.length} note(s)</summary>`,
    );
    lines.push("");
    for (const note of c.notes) {
      const loc = noteLocation(note);
      lines.push(
        loc === ""
          ? `- ${note.observation}`
          : `- \`${loc}\` — ${note.observation}`,
      );
      if (note.suggestion !== null) {
        lines.push(`  - _suggestion:_ ${note.suggestion}`);
      }
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  lines.push(`_${footer(usage, model)}_`);
  return lines.join("\n");
}

/** Same information as {@link formatReviewMarkdown}, as plain text for local runs. */
export function formatReviewTerminal(
  review: Review,
  decision: Decision,
  usage: ReviewUsage,
  model: string,
): string {
  const lines: string[] = [
    header(decision),
    "",
    review.summary,
    "",
    review.assessment,
    "",
  ];

  for (const id of CRITERION_IDS) {
    const c = review.criteria[id];
    lines.push(
      `${c.score}/10  ${CRITERION_LABELS[id]} [${CRITERION_GROUPS[id]}]`,
    );
    lines.push(`      ${oneLine(c.rationale)}`);
    for (const note of c.notes) {
      const loc = noteLocation(note);
      lines.push(`      - ${loc === "" ? "" : `${loc}: `}${note.observation}`);
      if (note.suggestion !== null) {
        lines.push(`        fix: ${note.suggestion}`);
      }
    }
  }

  lines.push("");
  lines.push(footer(usage, model));
  return lines.join("\n");
}
