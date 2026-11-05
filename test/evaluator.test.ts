import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateRetrieval,
  formatJsonReport,
  formatMarkdownReport,
  RetrievalDatasetInput
} from "../src/index.js";

describe("evaluateRetrieval hand-calculated ranking and decision cases", () => {
  it("computes exact per-query and macro-average metrics across ranking positions and K boundary", () => {
    const dataset: RetrievalDatasetInput = {
      version: 1,
      corpusDocIds: ["d1", "d2", "d3", "d4", "d5", "d6"],
      queries: [
        {
          // Case 1: first-position hit (rank 1)
          id: "q-first-pos",
          relevantDocIds: ["d1"],
          rankedDocIds: ["d1", "d2", "d3"],
          decision: "answer"
        },
        {
          // Case 2: third-position hit (rank 3)
          id: "q-third-pos",
          relevantDocIds: ["d3"],
          rankedDocIds: ["d1", "d2", "d3"],
          decision: "answer"
        },
        {
          // Case 3: no hit in ranked list
          id: "q-no-hit",
          relevantDocIds: ["d4"],
          rankedDocIds: ["d1", "d2", "d3"],
          decision: "answer"
        },
        {
          // Case 4: several relevant documents (3 relevant, 2 retrieved at ranks 2 and 3)
          id: "q-multi-rel",
          relevantDocIds: ["d2", "d3", "d5"],
          rankedDocIds: ["d1", "d2", "d3"],
          decision: "answer"
        },
        {
          // Case 5: fewer than K returned documents (only 1 returned doc when K=3)
          id: "q-fewer-than-k",
          relevantDocIds: ["d2", "d4"],
          rankedDocIds: ["d2"],
          decision: "answer"
        },
        {
          // Case 6: relevant document just beyond K (at rank 4 when K=3) + abstain decision
          id: "q-beyond-k",
          relevantDocIds: ["d6"],
          rankedDocIds: ["d1", "d2", "d3", "d6"],
          decision: "abstain"
        }
      ]
    };

    const report = evaluateRetrieval(dataset, 3);

    assert.equal(report.k, 3);
    assert.equal(report.corpusSize, 6);
    assert.equal(report.queries.length, 6);

    // Verify preserved query order
    assert.deepEqual(
      report.queries.map((q) => q.id),
      ["q-first-pos", "q-third-pos", "q-no-hit", "q-multi-rel", "q-fewer-than-k", "q-beyond-k"]
    );

    // 1. First-position hit
    assert.equal(report.queries[0].recallAtK, 1);
    assert.equal(report.queries[0].reciprocalRankAtK, 1);
    assert.equal(report.queries[0].hitAtK, 1);
    assert.equal(report.queries[0].firstRelevantRankAtK, 1);

    // 2. Third-position hit
    assert.equal(report.queries[1].recallAtK, 1);
    assert.equal(report.queries[1].reciprocalRankAtK, 1 / 3);
    assert.equal(report.queries[1].hitAtK, 1);
    assert.equal(report.queries[1].firstRelevantRankAtK, 3);

    // 3. No hit
    assert.equal(report.queries[2].recallAtK, 0);
    assert.equal(report.queries[2].reciprocalRankAtK, 0);
    assert.equal(report.queries[2].hitAtK, 0);
    assert.equal(report.queries[2].firstRelevantRankAtK, null);

    // 4. Several relevant documents (2 of 3 found at ranks 2 and 3)
    assert.equal(report.queries[3].recallAtK, 2 / 3);
    assert.equal(report.queries[3].reciprocalRankAtK, 1 / 2);
    assert.equal(report.queries[3].hitAtK, 1);
    assert.equal(report.queries[3].firstRelevantRankAtK, 2);

    // 5. Fewer than K returned documents (1 of 2 found at rank 1, only 1 doc returned)
    assert.equal(report.queries[4].evaluatedRankedCount, 1);
    assert.equal(report.queries[4].recallAtK, 1 / 2);
    assert.equal(report.queries[4].reciprocalRankAtK, 1);
    assert.equal(report.queries[4].hitAtK, 1);

    // 6. Relevant doc at rank K+1 (rank 4 > K=3) -> 0 hits at K=3; computed despite decision="abstain"
    assert.equal(report.queries[5].evaluatedRankedCount, 3);
    assert.equal(report.queries[5].relevantHitsAtK, 0);
    assert.equal(report.queries[5].recallAtK, 0);
    assert.equal(report.queries[5].reciprocalRankAtK, 0);
    assert.equal(report.queries[5].hitAtK, 0);
    assert.equal(report.queries[5].firstRelevantRankAtK, null);
    assert.equal(report.queries[5].decisionCorrect, false);

    // Macro averages over the 6 answerable queries:
    // Recall@3 = (1 + 1 + 0 + 2/3 + 1/2 + 0) / 6 = (19/6) / 6 = 19/36
    // MRR@3    = (1 + 1/3 + 0 + 1/2 + 1 + 0) / 6 = (17/6) / 6 = 17/36
    // Hit@3    = (1 + 1 + 0 + 1 + 1 + 0) / 6 = 4/6 = 2/3
    assert.ok(
      report.retrieval.recallAtK !== null &&
        Math.abs(report.retrieval.recallAtK - 19 / 36) < 1e-15
    );
    assert.ok(
      report.retrieval.mrrAtK !== null &&
        Math.abs(report.retrieval.mrrAtK - 17 / 36) < 1e-15
    );
    assert.ok(
      report.retrieval.hitRateAtK !== null &&
        Math.abs(report.retrieval.hitRateAtK - 4 / 6) < 1e-15
    );
  });

  it("computes retrieval metrics for an answerable query even when its decision is abstain", () => {
    const dataset: RetrievalDatasetInput = {
      version: 1,
      corpusDocIds: ["d1", "d2"],
      queries: [
        {
          id: "q-abstain-with-hit",
          relevantDocIds: ["d2"],
          rankedDocIds: ["d1", "d2"],
          decision: "abstain"
        }
      ]
    };

    const report = evaluateRetrieval(dataset, 2);
    assert.equal(report.queries[0].recallAtK, 1);
    assert.equal(report.queries[0].reciprocalRankAtK, 0.5);
    assert.equal(report.queries[0].hitAtK, 1);
    assert.equal(report.queries[0].expectedDecision, "answer");
    assert.equal(report.queries[0].actualDecision, "abstain");
    assert.equal(report.queries[0].decisionCorrect, false);
    assert.equal(report.retrieval.recallAtK, 1);
    assert.equal(report.retrieval.mrrAtK, 0.5);
    assert.equal(report.retrieval.hitRateAtK, 1);
    assert.equal(report.decision.falseAbstentionCount, 1);
  });

  it("covers all four expected/actual answer-abstain combinations", () => {
    const dataset: RetrievalDatasetInput = {
      version: 1,
      corpusDocIds: ["d1", "d2"],
      queries: [
        {
          // 1. Expected answer, actual answer -> true answer
          id: "q-true-answer",
          relevantDocIds: ["d1"],
          rankedDocIds: ["d1"],
          decision: "answer"
        },
        {
          // 2. Expected answer, actual abstain -> false abstention
          id: "q-false-abstention",
          relevantDocIds: ["d2"],
          rankedDocIds: ["d1"],
          decision: "abstain"
        },
        {
          // 3. Expected abstain, actual answer -> false answer
          id: "q-false-answer",
          relevantDocIds: [],
          rankedDocIds: ["d1"],
          decision: "answer"
        },
        {
          // 4. Expected abstain, actual abstain -> true abstention
          id: "q-true-abstention",
          relevantDocIds: [],
          rankedDocIds: [],
          decision: "abstain"
        }
      ]
    };

    const report = evaluateRetrieval(dataset, 2);
    assert.equal(report.decision.totalQueries, 4);
    assert.equal(report.decision.correctCount, 2);
    assert.equal(report.decision.accuracy, 0.5);
    assert.equal(report.decision.trueAnswerCount, 1);
    assert.equal(report.decision.falseAbstentionCount, 1);
    assert.equal(report.decision.falseAnswerCount, 1);
    assert.equal(report.decision.trueAbstentionCount, 1);

    // Only the first 2 queries are answerable
    assert.equal(report.retrieval.answerableQueryCount, 2);
    assert.equal(report.retrieval.unanswerableQueryCount, 2);
    assert.equal(report.retrieval.recallAtK, 0.5);
    assert.equal(report.retrieval.mrrAtK, 0.5);
    assert.equal(report.retrieval.hitRateAtK, 0.5);

    // Unanswerable queries have null retrieval metrics
    assert.equal(report.queries[2].recallAtK, null);
    assert.equal(report.queries[2].reciprocalRankAtK, null);
    assert.equal(report.queries[2].hitAtK, null);
    assert.equal(report.queries[3].recallAtK, null);
    assert.equal(report.queries[3].reciprocalRankAtK, null);
    assert.equal(report.queries[3].hitAtK, null);
  });

  it("returns null aggregate retrieval metrics when all queries are unanswerable", () => {
    const dataset: RetrievalDatasetInput = {
      version: 1,
      corpusDocIds: ["d1", "d2"],
      queries: [
        {
          id: "u1",
          relevantDocIds: [],
          rankedDocIds: ["d1"],
          decision: "abstain"
        },
        {
          id: "u2",
          relevantDocIds: [],
          rankedDocIds: ["d2"],
          decision: "answer"
        }
      ]
    };

    const report = evaluateRetrieval(dataset, 1);
    assert.equal(report.retrieval.answerableQueryCount, 0);
    assert.equal(report.retrieval.unanswerableQueryCount, 2);
    assert.equal(report.retrieval.recallAtK, null);
    assert.equal(report.retrieval.mrrAtK, null);
    assert.equal(report.retrieval.hitRateAtK, null);

    assert.equal(report.decision.totalQueries, 2);
    assert.equal(report.decision.correctCount, 1);
    assert.equal(report.decision.accuracy, 0.5);
    assert.equal(report.decision.falseAnswerCount, 1);
    assert.equal(report.decision.trueAbstentionCount, 1);
  });

  it("returns null aggregate retrieval metrics and null decision accuracy when queries is empty", () => {
    const dataset: RetrievalDatasetInput = {
      version: 1,
      corpusDocIds: ["d1"],
      queries: []
    };

    const report = evaluateRetrieval(dataset, 5);
    assert.equal(report.retrieval.answerableQueryCount, 0);
    assert.equal(report.retrieval.unanswerableQueryCount, 0);
    assert.equal(report.retrieval.recallAtK, null);
    assert.equal(report.retrieval.mrrAtK, null);
    assert.equal(report.retrieval.hitRateAtK, null);

    assert.equal(report.decision.totalQueries, 0);
    assert.equal(report.decision.correctCount, 0);
    assert.equal(report.decision.accuracy, null);
    assert.equal(report.decision.falseAnswerCount, 0);
    assert.equal(report.decision.falseAbstentionCount, 0);
    assert.equal(report.queries.length, 0);
  });

  it("does not change retrieval metrics when appending an irrelevant document after K", () => {
    const baseDataset: RetrievalDatasetInput = {
      version: 1,
      corpusDocIds: ["d1", "d2", "d3", "d4", "d5"],
      queries: [
        {
          id: "q1",
          relevantDocIds: ["d2"],
          rankedDocIds: ["d1", "d2", "d3"],
          decision: "answer"
        }
      ]
    };

    const extendedDataset: RetrievalDatasetInput = {
      version: 1,
      corpusDocIds: ["d1", "d2", "d3", "d4", "d5"],
      queries: [
        {
          id: "q1",
          relevantDocIds: ["d2"],
          rankedDocIds: ["d1", "d2", "d3", "d4", "d5"],
          decision: "answer"
        }
      ]
    };

    const r1 = evaluateRetrieval(baseDataset, 3);
    const r2 = evaluateRetrieval(extendedDataset, 3);

    assert.deepEqual(r1.retrieval, r2.retrieval);
    assert.equal(r1.queries[0].recallAtK, r2.queries[0].recallAtK);
    assert.equal(r1.queries[0].reciprocalRankAtK, r2.queries[0].reciprocalRankAtK);
    assert.equal(r1.queries[0].hitAtK, r2.queries[0].hitAtK);
    assert.equal(r1.queries[0].firstRelevantRankAtK, r2.queries[0].firstRelevantRankAtK);
  });

  it("does not mutate caller arrays or objects and produces identical JSON/Markdown across repeated calls", () => {
    const corpusDocIds = Object.freeze(["d1", "d2", "d3"]);
    const relevantDocIds = Object.freeze(["d2", "d3"]);
    const rankedDocIds = Object.freeze(["d1", "d3", "d2"]);
    const query = Object.freeze({
      id: "q1",
      relevantDocIds,
      rankedDocIds,
      decision: "answer" as const
    });
    const dataset = Object.freeze({
      version: 1 as const,
      corpusDocIds,
      queries: Object.freeze([query])
    });

    const reportA = evaluateRetrieval(dataset, 2);
    const reportB = evaluateRetrieval(dataset, 2);

    const jsonA = formatJsonReport(reportA);
    const jsonB = formatJsonReport(reportB);
    const mdA = formatMarkdownReport(reportA);
    const mdB = formatMarkdownReport(reportB);

    assert.equal(jsonA, jsonB);
    assert.equal(mdA, mdB);

    const parsedJson = JSON.parse(jsonA);
    assert.equal(parsedJson.retrieval.recallAtK, 0.5);
    assert.equal(parsedJson.retrieval.mrrAtK, 0.5);
    assert.equal(parsedJson.retrieval.hitRateAtK, 1);
    assert.match(mdA, /\| Recall@2 \| 0\.5000 \|/);
    assert.match(mdA, /\| MRR@2 \| 0\.5000 \|/);
    assert.match(mdA, /\| HitRate@2 \| 1\.0000 \|/);
  });
});
