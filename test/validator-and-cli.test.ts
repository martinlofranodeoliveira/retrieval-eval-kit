import * as assert from "node:assert/strict";
import * as path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  evaluateRetrieval,
  LIMITS,
  parseDatasetJson,
  ValidationError
} from "../src/index.js";
import { runCli } from "../src/cli.js";
import { runDemo } from "../src/demo.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "..", "..");
const examplePath = path.join(repoRoot, "examples", "retrieval.json");

describe("schema validation and adversarial rejection tests", () => {
  it("rejects duplicate corpus, query, relevant, and ranked document IDs", () => {
    assert.throws(
      () =>
        evaluateRetrieval(
          {
            version: 1,
            corpusDocIds: ["doc-1", "doc-1"],
            queries: []
          },
          3
        ),
      (err: unknown) => err instanceof ValidationError && err.code === "DUPLICATE_CORPUS_DOC_ID"
    );

    assert.throws(
      () =>
        evaluateRetrieval(
          {
            version: 1,
            corpusDocIds: ["doc-1"],
            queries: [
              { id: "q-1", relevantDocIds: [], rankedDocIds: [], decision: "abstain" },
              { id: "q-1", relevantDocIds: [], rankedDocIds: [], decision: "abstain" }
            ]
          },
          3
        ),
      (err: unknown) => err instanceof ValidationError && err.code === "DUPLICATE_QUERY_ID"
    );

    assert.throws(
      () =>
        evaluateRetrieval(
          {
            version: 1,
            corpusDocIds: ["doc-1", "doc-2"],
            queries: [
              {
                id: "q-1",
                relevantDocIds: ["doc-1", "doc-1"],
                rankedDocIds: [],
                decision: "answer"
              }
            ]
          },
          3
        ),
      (err: unknown) => err instanceof ValidationError && err.code === "DUPLICATE_RELEVANT_DOC_ID"
    );

    assert.throws(
      () =>
        evaluateRetrieval(
          {
            version: 1,
            corpusDocIds: ["doc-1", "doc-2"],
            queries: [
              {
                id: "q-1",
                relevantDocIds: ["doc-1"],
                rankedDocIds: ["doc-2", "doc-2"],
                decision: "answer"
              }
            ]
          },
          3
        ),
      (err: unknown) => err instanceof ValidationError && err.code === "DUPLICATE_RANKED_DOC_ID"
    );
  });

  it("rejects unknown documents in relevantDocIds and rankedDocIds", () => {
    assert.throws(
      () =>
        evaluateRetrieval(
          {
            version: 1,
            corpusDocIds: ["doc-1"],
            queries: [
              {
                id: "q-1",
                relevantDocIds: ["doc-unknown"],
                rankedDocIds: [],
                decision: "answer"
              }
            ]
          },
          1
        ),
      (err: unknown) => err instanceof ValidationError && err.code === "UNKNOWN_RELEVANT_DOC_ID"
    );

    assert.throws(
      () =>
        evaluateRetrieval(
          {
            version: 1,
            corpusDocIds: ["doc-1"],
            queries: [
              {
                id: "q-1",
                relevantDocIds: [],
                rankedDocIds: ["doc-unknown"],
                decision: "abstain"
              }
            ]
          },
          1
        ),
      (err: unknown) => err instanceof ValidationError && err.code === "UNKNOWN_RANKED_DOC_ID"
    );
  });

  it("rejects invalid decision values and unknown properties", () => {
    assert.throws(
      () =>
        evaluateRetrieval(
          {
            version: 1,
            corpusDocIds: ["doc-1"],
            queries: [
              {
                id: "q-1",
                relevantDocIds: [],
                rankedDocIds: [],
                decision: "maybe"
              }
            ]
          },
          1
        ),
      (err: unknown) => err instanceof ValidationError && err.code === "INVALID_DECISION"
    );

    assert.throws(
      () =>
        evaluateRetrieval(
          {
            version: 1,
            corpusDocIds: ["doc-1"],
            queries: [],
            extraRootField: true
          },
          1
        ),
      (err: unknown) => err instanceof ValidationError && err.code === "UNKNOWN_PROPERTY"
    );

    assert.throws(
      () =>
        evaluateRetrieval(
          {
            version: 1,
            corpusDocIds: ["doc-1"],
            queries: [
              {
                id: "q-1",
                relevantDocIds: [],
                rankedDocIds: [],
                decision: "abstain",
                text: "document text is disallowed"
              }
            ]
          },
          1
        ),
      (err: unknown) => err instanceof ValidationError && err.code === "UNKNOWN_PROPERTY"
    );
  });

  it("rejects K=0, negative K, K>1000, non-integer K, non-finite K, and unsafe integer K", () => {
    const validDataset = {
      version: 1,
      corpusDocIds: ["doc-1"],
      queries: []
    };

    for (const badK of [
      0,
      -1,
      1001,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
      "3"
    ]) {
      assert.throws(
        () => evaluateRetrieval(validDataset, badK),
        (err: unknown) =>
          err instanceof ValidationError &&
          (err.code === "INVALID_K" || err.code === "OUT_OF_RANGE_K"),
        `Expected K=${String(badK)} to be rejected`
      );
    }
  });

  it("rejects excessive counts, oversized IDs, and oversized raw JSON byte inputs", () => {
    // Empty corpus
    assert.throws(
      () => evaluateRetrieval({ version: 1, corpusDocIds: [], queries: [] }, 1),
      (err: unknown) => err instanceof ValidationError && err.code === "CORPUS_COUNT_OUT_OF_RANGE"
    );

    // Excessive corpus count
    const hugeCorpus = Array.from(
      { length: LIMITS.MAX_CORPUS_DOCS + 1 },
      (_, idx) => `d-${idx}`
    );
    assert.throws(
      () => evaluateRetrieval({ version: 1, corpusDocIds: hugeCorpus, queries: [] }, 1),
      (err: unknown) => err instanceof ValidationError && err.code === "CORPUS_COUNT_OUT_OF_RANGE"
    );

    // Excessive ranked docs per query
    const rankedCorpus = Array.from(
      { length: LIMITS.MAX_RANKED_DOCS_PER_QUERY + 1 },
      (_, idx) => `d-${idx}`
    );
    assert.throws(
      () =>
        evaluateRetrieval(
          {
            version: 1,
            corpusDocIds: rankedCorpus,
            queries: [
              {
                id: "q-1",
                relevantDocIds: [],
                rankedDocIds: rankedCorpus,
                decision: "abstain"
              }
            ]
          },
          1
        ),
      (err: unknown) => err instanceof ValidationError && err.code === "RANKED_COUNT_OUT_OF_RANGE"
    );

    // Oversized ID
    const longId = "a".repeat(LIMITS.MAX_ID_LENGTH + 1);
    assert.throws(
      () => evaluateRetrieval({ version: 1, corpusDocIds: [longId], queries: [] }, 1),
      (err: unknown) => err instanceof ValidationError && err.code === "INVALID_ID_LENGTH"
    );

    // Oversized input bytes
    const oversizedString = " ".repeat(LIMITS.MAX_INPUT_BYTES + 10);
    assert.throws(
      () => parseDatasetJson(oversizedString),
      (err: unknown) => err instanceof ValidationError && err.code === "INPUT_TOO_LARGE"
    );
  });
});

describe("CLI and offline demo execution", () => {
  it("exits 0 and emits valid JSON and Markdown reports for examples/retrieval.json", () => {
    let jsonOut = "";
    let errOut = "";
    const codeJson = runCli([examplePath, "--k", "3", "--format", "json"], {
      stdout: (t) => {
        jsonOut += t;
      },
      stderr: (t) => {
        errOut += t;
      }
    });

    assert.equal(codeJson, 0);
    assert.equal(errOut, "");
    const parsed = JSON.parse(jsonOut);
    assert.equal(parsed.k, 3);
    assert.equal(parsed.retrieval.recallAtK, 0.625);
    assert.equal(parsed.retrieval.mrrAtK, 0.625);
    assert.equal(parsed.retrieval.hitRateAtK, 0.75);
    assert.equal(parsed.decision.correctCount, 5);
    assert.equal(parsed.decision.totalQueries, 6);

    let mdOut = "";
    const codeMd = runCli([examplePath, "--k", "3", "--format", "markdown"], {
      stdout: (t) => {
        mdOut += t;
      },
      stderr: (t) => {
        errOut += t;
      }
    });

    assert.equal(codeMd, 0);
    assert.match(mdOut, /# Retrieval Evaluation Report/);
    assert.match(mdOut, /\| Recall@3 \| 0\.6250 \|/);
    assert.match(mdOut, /\| MRR@3 \| 0\.6250 \|/);
    assert.match(mdOut, /\| HitRate@3 \| 0\.7500 \|/);
    assert.match(mdOut, /\| Accuracy \| 0\.8333 \|/);
  });

  it("exits 2 for invalid K, missing arguments, or nonexistent files", () => {
    for (const invalidArgs of [
      [],
      [examplePath],
      [examplePath, "--k", "0"],
      [examplePath, "--k", "3.5"],
      [examplePath, "--k", "3", "--format", "xml"],
      ["nonexistent-file.json", "--k", "3"]
    ]) {
      let errOut = "";
      const code = runCli(invalidArgs, {
        stdout: () => {},
        stderr: (t) => {
          errOut += t;
        }
      });
      assert.equal(code, 2, `Expected exit code 2 for args ${JSON.stringify(invalidArgs)}`);
      assert.ok(errOut.length > 0);
    }
  });

  it("executes the deterministic demo without errors", () => {
    let demoOut = "";
    runDemo((t) => {
      demoOut += t;
    });
    assert.match(demoOut, /# Retrieval Ranking Comparison \(K = 3\)/);
    assert.match(demoOut, /\| Recall@3 \| 0\.3750 \| 0\.6250 \| \+0\.2500 \|/);
    assert.match(demoOut, /\| MRR@3 \| 0\.1667 \| 0\.6250 \| \+0\.4583 \|/);
  });
});
