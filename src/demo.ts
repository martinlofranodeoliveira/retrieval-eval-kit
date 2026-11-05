#!/usr/bin/env node
import * as assert from "node:assert/strict";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  compareRetrievalDatasets,
  evaluateRetrieval,
  formatComparisonMarkdown,
  loadDatasetFromFile
} from "./index.js";

export function runDemo(write: (text: string) => void = (t) => process.stdout.write(t)): void {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(currentDir, "..", "..");
  const baselinePath = path.join(repoRoot, "examples", "retrieval-baseline.json");
  const candidatePath = path.join(repoRoot, "examples", "retrieval.json");

  const k = 3;
  const baselineDataset = loadDatasetFromFile(baselinePath);
  const candidateDataset = loadDatasetFromFile(candidatePath);

  const baselineReport = evaluateRetrieval(baselineDataset, k);
  const candidateReport = evaluateRetrieval(candidateDataset, k);
  const comparison = compareRetrievalDatasets(baselineDataset, candidateDataset, k);

  // Deterministic verification of baseline metrics at K=3
  assert.equal(baselineReport.retrieval.answerableQueryCount, 4);
  assert.equal(baselineReport.retrieval.unanswerableQueryCount, 2);
  assert.equal(baselineReport.retrieval.recallAtK, 0.375);
  assert.equal(baselineReport.retrieval.mrrAtK, 1 / 6);
  assert.equal(baselineReport.retrieval.hitRateAtK, 0.5);
  assert.equal(baselineReport.decision.correctCount, 3);
  assert.equal(baselineReport.decision.totalQueries, 6);
  assert.equal(baselineReport.decision.accuracy, 0.5);
  assert.equal(baselineReport.decision.falseAnswerCount, 1);
  assert.equal(baselineReport.decision.falseAbstentionCount, 2);

  // Deterministic verification of candidate metrics at K=3
  assert.equal(candidateReport.retrieval.recallAtK, 0.625);
  assert.equal(candidateReport.retrieval.mrrAtK, 0.625);
  assert.equal(candidateReport.retrieval.hitRateAtK, 0.75);
  assert.equal(candidateReport.decision.correctCount, 5);
  assert.equal(candidateReport.decision.totalQueries, 6);
  assert.equal(candidateReport.decision.accuracy, 5 / 6);
  assert.equal(candidateReport.decision.falseAnswerCount, 0);
  assert.equal(candidateReport.decision.falseAbstentionCount, 1);

  // Deterministic verification of metric improvements
  assert.equal(comparison.metrics.recallAtK.delta, 0.25);
  assert.ok(
    comparison.metrics.mrrAtK.delta !== null &&
      Math.abs(comparison.metrics.mrrAtK.delta - 11 / 24) < 1e-15
  );
  assert.equal(comparison.metrics.hitRateAtK.delta, 0.25);
  assert.ok(
    comparison.metrics.decisionAccuracy.delta !== null &&
      Math.abs(comparison.metrics.decisionAccuracy.delta - 1 / 3) < 1e-15
  );
  assert.equal(comparison.metrics.falseAnswerCount.delta, -1);
  assert.equal(comparison.metrics.falseAbstentionCount.delta, -1);

  write(formatComparisonMarkdown(comparison));
  write("\n## Machine-Readable Comparison JSON\n\n");
  write(`${JSON.stringify(comparison, null, 2)}\n`);
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  runDemo();
}
