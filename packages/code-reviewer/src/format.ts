import type { Review, Severity } from "./schemas.js";

const useColor =
  process.stdout.isTTY === true && process.env["NO_COLOR"] === undefined;

const paint = (code: number, text: string): string =>
  useColor ? `\x1b[${code}m${text}\x1b[0m` : text;

const bold = (text: string) => paint(1, text);
const dim = (text: string) => paint(2, text);

const SEVERITY_COLOR: Record<Severity, number> = {
  critical: 41, // red background
  high: 31, // red
  medium: 33, // yellow
  low: 36, // cyan
  info: 34, // blue
};

const SEVERITY_ORDER: Severity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];

const VERDICT_LABEL: Record<Review["verdict"], string> = {
  approve: paint(32, "APPROVE"),
  comment: paint(33, "COMMENT"),
  request_changes: paint(31, "REQUEST CHANGES"),
};

/** Render a review for a terminal. */
export function formatReview(review: Review): string {
  const lines: string[] = [];

  lines.push(bold(`Verdict: ${VERDICT_LABEL[review.verdict]}`));
  lines.push("");
  lines.push(review.summary);
  lines.push("");

  if (review.findings.length === 0) {
    lines.push(dim("No findings."));
    return lines.join("\n");
  }

  const sorted = [...review.findings].sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );

  lines.push(bold(`${sorted.length} finding(s):`));
  for (const finding of sorted) {
    const badge = paint(
      SEVERITY_COLOR[finding.severity],
      ` ${finding.severity.toUpperCase()} `,
    );
    const location =
      finding.line === null ? finding.file : `${finding.file}:${finding.line}`;
    lines.push("");
    lines.push(
      `${badge} ${bold(finding.title)}  ${dim(`[${finding.category}]`)}`,
    );
    lines.push(`  ${dim(location)}`);
    lines.push(`  ${finding.description}`);
    if (finding.suggestion !== null) {
      lines.push(`  ${dim("fix:")} ${finding.suggestion}`);
    }
  }

  return lines.join("\n");
}
