import {
  Decision,
  EvaluationComparisonReport,
  EvaluationReport,
  MetricComparisonDelta,
  QueryEvaluationResult,
  SCHEMA_VERSION,
  ValidationError
} from "./types.js";
import { validateDataset, validateK } from "./validator.js";

export function evaluateRetrieval(rawInput: unknown, rawK: unknown): EvaluationReport {
  const k = validateK(rawK);
  const dataset = validateDataset(rawInput);

  const queryResults: QueryEvaluationResult[] = [];

  let answerableQueryCount = 0;
  let unanswerableQueryCount = 0;
  let recallSum = 0;
  let reciprocalRankSum = 0;
  let hitSum = 0;

  let correctDecisionCount = 0;
  let falseAnswerCount = 0;
  let falseAbstentionCount = 0;
  let trueAnswerCount = 0;
  let trueAbstentionCount = 0;

  for (const query of dataset.queries) {
    const relevantCount = query.relevantDocIds.length;
    const answerable = relevantCount > 0;
    const expectedDecision: Decision = answerable ? "answer" : "abstain";
    const actualDecision: Decision = query.decision;
    const decisionCorrect = actualDecision === expectedDecision;

    if (decisionCorrect) {
      correctDecisionCount += 1;
      if (expectedDecision === "answer") {
        trueAnswerCount += 1;
      } else {
        trueAbstentionCount += 1;
      }
    } else if (expectedDecision === "abstain" && actualDecision === "answer") {
      falseAnswerCount += 1;
    } else {
      falseAbstentionCount += 1;
    }

    const topKDocs = query.rankedDocIds.slice(0, k);
    const relevantSet = new Set(query.relevantDocIds);

    let relevantHitsAtK = 0;
    let firstRelevantRankAtK: number | null = null;

    for (let idx = 0; idx < topKDocs.length; idx++) {
      if (relevantSet.has(topKDocs[idx])) {
        relevantHitsAtK += 1;
        if (firstRelevantRankAtK === null) {
          firstRelevantRankAtK = idx + 1;
        }
      }
    }

    let recallAtK: number | null = null;
    let reciprocalRankAtK: number | null = null;
    let hitAtK: number | null = null;

    if (answerable) {
      answerableQueryCount += 1;
      recallAtK = relevantHitsAtK / relevantCount;
      reciprocalRankAtK = firstRelevantRankAtK !== null ? 1 / firstRelevantRankAtK : 0;
      hitAtK = relevantHitsAtK > 0 ? 1 : 0;

      recallSum += recallAtK;
      reciprocalRankSum += reciprocalRankAtK;
      hitSum += hitAtK;
    } else {
      unanswerableQueryCount += 1;
    }

    queryResults.push({
      id: query.id,
      answerable,
      relevantCount,
      rankedCount: query.rankedDocIds.length,
      evaluatedRankedCount: topKDocs.length,
      relevantHitsAtK,
      firstRelevantRankAtK,
      recallAtK,
      reciprocalRankAtK,
      hitAtK,
      expectedDecision,
      actualDecision,
      decisionCorrect
    });
  }

  const totalQueries = dataset.queries.length;

  return {
    version: SCHEMA_VERSION,
    k,
    corpusSize: dataset.corpusDocIds.length,
    retrieval: {
      answerableQueryCount,
      unanswerableQueryCount,
      recallAtK: answerableQueryCount > 0 ? recallSum / answerableQueryCount : null,
      mrrAtK: answerableQueryCount > 0 ? reciprocalRankSum / answerableQueryCount : null,
      hitRateAtK: answerableQueryCount > 0 ? hitSum / answerableQueryCount : null
    },
    decision: {
      totalQueries,
      correctCount: correctDecisionCount,
      accuracy: totalQueries > 0 ? correctDecisionCount / totalQueries : null,
      falseAnswerCount,
      falseAbstentionCount,
      trueAnswerCount,
      trueAbstentionCount
    },
    queries: queryResults
  };
}

function computeDelta(baseline: number | null, candidate: number | null): MetricComparisonDelta {
  if (baseline === null || candidate === null) {
    return { baseline, candidate, delta: null };
  }
  return {
    baseline,
    candidate,
    delta: candidate - baseline
  };
}

export function compareRetrievalDatasets(
  baselineInput: unknown,
  candidateInput: unknown,
  rawK: unknown
): EvaluationComparisonReport {
  const k = validateK(rawK);
  const baselineDataset = validateDataset(baselineInput);
  const candidateDataset = validateDataset(candidateInput);

  if (baselineDataset.corpusDocIds.length !== candidateDataset.corpusDocIds.length) {
    throw new ValidationError(
      "MISMATCHED_CORPUS",
      "Baseline and candidate datasets must declare the exact same corpusDocIds."
    );
  }

  for (let i = 0; i < baselineDataset.corpusDocIds.length; i++) {
    if (baselineDataset.corpusDocIds[i] !== candidateDataset.corpusDocIds[i]) {
      throw new ValidationError(
        "MISMATCHED_CORPUS",
        `Corpus document mismatch at index ${i}: "${baselineDataset.corpusDocIds[i]}" vs "${candidateDataset.corpusDocIds[i]}".`
      );
    }
  }

  if (baselineDataset.queries.length !== candidateDataset.queries.length) {
    throw new ValidationError(
      "MISMATCHED_QUERIES",
      "Baseline and candidate datasets must contain the exact same number of labeled queries."
    );
  }

  for (let i = 0; i < baselineDataset.queries.length; i++) {
    const bq = baselineDataset.queries[i];
    const cq = candidateDataset.queries[i];
    if (bq.id !== cq.id) {
      throw new ValidationError(
        "MISMATCHED_QUERIES",
        `Query ID mismatch at index ${i}: "${bq.id}" vs "${cq.id}".`
      );
    }
    if (bq.relevantDocIds.length !== cq.relevantDocIds.length) {
      throw new ValidationError(
        "MISMATCHED_LABELS",
        `Query "${bq.id}" has different relevantDocIds counts between baseline and candidate.`
      );
    }
    const bRel = new Set(bq.relevantDocIds);
    for (const docId of cq.relevantDocIds) {
      if (!bRel.has(docId)) {
        throw new ValidationError(
          "MISMATCHED_LABELS",
          `Query "${bq.id}" has mismatched relevantDocIds between baseline and candidate.`
        );
      }
    }
  }

  const baselineReport = evaluateRetrieval(baselineDataset, k);
  const candidateReport = evaluateRetrieval(candidateDataset, k);

  return {
    k,
    corpusSize: baselineReport.corpusSize,
    totalQueries: baselineReport.decision.totalQueries,
    answerableQueryCount: baselineReport.retrieval.answerableQueryCount,
    unanswerableQueryCount: baselineReport.retrieval.unanswerableQueryCount,
    metrics: {
      recallAtK: computeDelta(
        baselineReport.retrieval.recallAtK,
        candidateReport.retrieval.recallAtK
      ),
      mrrAtK: computeDelta(baselineReport.retrieval.mrrAtK, candidateReport.retrieval.mrrAtK),
      hitRateAtK: computeDelta(
        baselineReport.retrieval.hitRateAtK,
        candidateReport.retrieval.hitRateAtK
      ),
      decisionAccuracy: computeDelta(
        baselineReport.decision.accuracy,
        candidateReport.decision.accuracy
      ),
      falseAnswerCount: {
        baseline: baselineReport.decision.falseAnswerCount,
        candidate: candidateReport.decision.falseAnswerCount,
        delta:
          candidateReport.decision.falseAnswerCount - baselineReport.decision.falseAnswerCount
      },
      falseAbstentionCount: {
        baseline: baselineReport.decision.falseAbstentionCount,
        candidate: candidateReport.decision.falseAbstentionCount,
        delta:
          candidateReport.decision.falseAbstentionCount -
          baselineReport.decision.falseAbstentionCount
      }
    }
  };
}
