import { EvaluationComparisonReport, EvaluationReport } from "./types.js";

export const MARKDOWN_DECIMAL_PLACES = 4;

export function formatMetricValue(value: number | null): string {
  return value === null ? "null" : value.toFixed(MARKDOWN_DECIMAL_PLACES);
}

export function formatSignedDelta(value: number | null): string {
  if (value === null) return "null";
  return `${value > 0 ? "+" : ""}${value.toFixed(MARKDOWN_DECIMAL_PLACES)}`;
}

function markdownIdentifier(value: string): string {
  // Entity-encode syntax, HTML delimiters, pipes and nonprinting characters.
  // The replacement is single-pass: literal entity text cannot be reinterpreted
  // as a delimiter. Ordinary letters, numbers, spaces, dots and hyphens remain.
  return value.replace(/[^\p{L}\p{N} .-]/gu, (char) => `&#${char.codePointAt(0)};`);
}

export function formatJsonReport(report: EvaluationReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function formatMarkdownReport(report: EvaluationReport): string {
  const lines: string[] = [];
  const k = report.k;
  lines.push("# Retrieval Evaluation Report", "");
  lines.push(`- **Schema Version**: ${report.version}`);
  lines.push(`- **Cutoff (K)**: ${k}`);
  lines.push(`- **Corpus Size**: ${report.corpusSize}`);
  lines.push(`- **Total Queries**: ${report.decision.totalQueries}`);
  lines.push(`- **Answerable Queries**: ${report.retrieval.answerableQueryCount}`);
  lines.push(`- **Unanswerable Queries**: ${report.retrieval.unanswerableQueryCount}`);
  lines.push("", "## Aggregate Retrieval Metrics (Answerable Queries Only)", "");
  lines.push("| Metric | Value |", "| --- | --- |");
  lines.push(`| Recall@${k} | ${formatMetricValue(report.retrieval.recallAtK)} |`);
  lines.push(`| MRR@${k} | ${formatMetricValue(report.retrieval.mrrAtK)} |`);
  lines.push(`| HitRate@${k} | ${formatMetricValue(report.retrieval.hitRateAtK)} |`);
  lines.push("", "## Decision Evaluation (All Queries)", "");
  lines.push("| Metric | Value |", "| --- | --- |");
  lines.push(`| Correct / Total | ${report.decision.correctCount} / ${report.decision.totalQueries} |`);
  lines.push(`| Accuracy | ${formatMetricValue(report.decision.accuracy)} |`);
  lines.push(`| False Answers | ${report.decision.falseAnswerCount} |`);
  lines.push(`| False Abstentions | ${report.decision.falseAbstentionCount} |`);
  lines.push(`| True Answers | ${report.decision.trueAnswerCount} |`);
  lines.push(`| True Abstentions | ${report.decision.trueAbstentionCount} |`);
  lines.push("", "## Per-Query Breakdown", "");
  lines.push(`| Query ID | Answerable | Relevant | Hits@${k} | First Hit Rank@${k} | Recall@${k} | RR@${k} | Hit@${k} | Expected Decision | Actual Decision | Decision Correct |`);
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const q of report.queries) {
    const firstRank = q.firstRelevantRankAtK === null ? "null" : String(q.firstRelevantRankAtK);
    lines.push(`| ${markdownIdentifier(q.id)} | ${q.answerable} | ${q.relevantCount} | ${q.relevantHitsAtK} | ${firstRank} | ${formatMetricValue(q.recallAtK)} | ${formatMetricValue(q.reciprocalRankAtK)} | ${formatMetricValue(q.hitAtK)} | ${q.expectedDecision} | ${q.actualDecision} | ${q.decisionCorrect} |`);
  }
  lines.push("", "> Scope note: These metrics measure offline retrieval ranking and answer/abstain alignment against labeled IDs only. They do not evaluate generated answer factuality, semantic truth, or security.", "");
  return lines.join("\n");
}

export function formatComparisonMarkdown(comparison: EvaluationComparisonReport): string {
  const k = comparison.k;
  const m = comparison.metrics;
  const lines: string[] = [];
  lines.push(`# Retrieval Ranking Comparison (K = ${k})`, "");
  lines.push(`- **Corpus Size**: ${comparison.corpusSize} | **Total Queries**: ${comparison.totalQueries} (${comparison.answerableQueryCount} answerable, ${comparison.unanswerableQueryCount} unanswerable)`);
  lines.push("", "| Metric | Baseline | Candidate | Delta |", "| --- | --- | --- | --- |");
  lines.push(`| Recall@${k} | ${formatMetricValue(m.recallAtK.baseline)} | ${formatMetricValue(m.recallAtK.candidate)} | ${formatSignedDelta(m.recallAtK.delta)} |`);
  lines.push(`| MRR@${k} | ${formatMetricValue(m.mrrAtK.baseline)} | ${formatMetricValue(m.mrrAtK.candidate)} | ${formatSignedDelta(m.mrrAtK.delta)} |`);
  lines.push(`| HitRate@${k} | ${formatMetricValue(m.hitRateAtK.baseline)} | ${formatMetricValue(m.hitRateAtK.candidate)} | ${formatSignedDelta(m.hitRateAtK.delta)} |`);
  lines.push(`| Decision Accuracy | ${formatMetricValue(m.decisionAccuracy.baseline)} | ${formatMetricValue(m.decisionAccuracy.candidate)} | ${formatSignedDelta(m.decisionAccuracy.delta)} |`);
  lines.push(`| False Answers | ${m.falseAnswerCount.baseline} | ${m.falseAnswerCount.candidate} | ${m.falseAnswerCount.delta > 0 ? "+" : ""}${m.falseAnswerCount.delta} |`);
  lines.push(`| False Abstentions | ${m.falseAbstentionCount.baseline} | ${m.falseAbstentionCount.candidate} | ${m.falseAbstentionCount.delta > 0 ? "+" : ""}${m.falseAbstentionCount.delta} |`);
  lines.push("");
  return lines.join("\n");
}
