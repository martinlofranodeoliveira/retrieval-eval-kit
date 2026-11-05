export const SCHEMA_VERSION = 1 as const;

export const LIMITS = Object.freeze({
  MAX_INPUT_BYTES: 1_048_576,
  MAX_JSON_DEPTH: 8,
  MIN_CORPUS_DOCS: 1,
  MAX_CORPUS_DOCS: 10_000,
  MIN_QUERIES: 0,
  MAX_QUERIES: 5_000,
  MAX_RANKED_DOCS_PER_QUERY: 1_000,
  MIN_ID_LENGTH: 1,
  MAX_ID_LENGTH: 128,
  MIN_K: 1,
  MAX_K: 1_000
});

export type Decision = "answer" | "abstain";

export interface QueryCaseInput {
  readonly id: string;
  readonly relevantDocIds: readonly string[];
  readonly rankedDocIds: readonly string[];
  readonly decision: Decision;
}

export interface RetrievalDatasetInput {
  readonly version: typeof SCHEMA_VERSION;
  readonly corpusDocIds: readonly string[];
  readonly queries: readonly QueryCaseInput[];
}

export interface QueryEvaluationResult {
  readonly id: string;
  readonly answerable: boolean;
  readonly relevantCount: number;
  readonly rankedCount: number;
  readonly evaluatedRankedCount: number;
  readonly relevantHitsAtK: number;
  readonly firstRelevantRankAtK: number | null;
  readonly recallAtK: number | null;
  readonly reciprocalRankAtK: number | null;
  readonly hitAtK: number | null;
  readonly expectedDecision: Decision;
  readonly actualDecision: Decision;
  readonly decisionCorrect: boolean;
}

export interface AggregateRetrievalMetrics {
  readonly answerableQueryCount: number;
  readonly unanswerableQueryCount: number;
  readonly recallAtK: number | null;
  readonly mrrAtK: number | null;
  readonly hitRateAtK: number | null;
}

export interface AggregateDecisionMetrics {
  readonly totalQueries: number;
  readonly correctCount: number;
  readonly accuracy: number | null;
  readonly falseAnswerCount: number;
  readonly falseAbstentionCount: number;
  readonly trueAnswerCount: number;
  readonly trueAbstentionCount: number;
}

export interface EvaluationReport {
  readonly version: typeof SCHEMA_VERSION;
  readonly k: number;
  readonly corpusSize: number;
  readonly retrieval: AggregateRetrievalMetrics;
  readonly decision: AggregateDecisionMetrics;
  readonly queries: readonly QueryEvaluationResult[];
}

export interface MetricComparisonDelta {
  readonly baseline: number | null;
  readonly candidate: number | null;
  readonly delta: number | null;
}

export interface EvaluationComparisonReport {
  readonly k: number;
  readonly corpusSize: number;
  readonly totalQueries: number;
  readonly answerableQueryCount: number;
  readonly unanswerableQueryCount: number;
  readonly metrics: {
    readonly recallAtK: MetricComparisonDelta;
    readonly mrrAtK: MetricComparisonDelta;
    readonly hitRateAtK: MetricComparisonDelta;
    readonly decisionAccuracy: MetricComparisonDelta;
    readonly falseAnswerCount: {
      readonly baseline: number;
      readonly candidate: number;
      readonly delta: number;
    };
    readonly falseAbstentionCount: {
      readonly baseline: number;
      readonly candidate: number;
      readonly delta: number;
    };
  };
}

export class ValidationError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = "ValidationError";
    this.code = code;
  }
}
