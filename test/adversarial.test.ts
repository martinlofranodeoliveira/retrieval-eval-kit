import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import {
  evaluateDatasetFile,
  evaluateRetrieval,
  LIMITS,
  loadDatasetFromFile,
  parseDatasetJson,
  validateDataset,
  ValidationError
} from "../src/index.js";

function empty() {
  return { version: 1, corpusDocIds: ["a"], queries: [] };
}

function single() {
  return {
    version: 1,
    corpusDocIds: ["a", "b", "c"],
    queries: [{ id: "q", relevantDocIds: ["c"], rankedDocIds: ["a", "b", "c"], decision: "answer" }]
  };
}

function errorCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof ValidationError && error.code === code;
}

describe("independent raw JSON boundary checks", () => {
  it("accepts exactly the byte limit and rejects one byte over, counting UTF-8 rather than characters", () => {
    const json = JSON.stringify(empty());
    const exact = json + " ".repeat(LIMITS.MAX_INPUT_BYTES - Buffer.byteLength(json));
    assert.deepEqual(parseDatasetJson(exact), empty());
    assert.deepEqual(parseDatasetJson(Buffer.from(exact)), empty());
    assert.throws(() => parseDatasetJson(exact + " "), errorCode("INPUT_TOO_LARGE"));
    const multi = '"' + "é".repeat(LIMITS.MAX_INPUT_BYTES / 2) + '"';
    assert.ok(multi.length < LIMITS.MAX_INPUT_BYTES);
    assert.throws(() => parseDatasetJson(multi), errorCode("INPUT_TOO_LARGE"));
  });

  it("does not silently overwrite duplicate JSON members, including escaped names", () => {
    for (const text of [
      '{"version":1,"version":1,"corpusDocIds":["a"],"queries":[]}',
      '{"version":1,"\\u0076ersion":1,"corpusDocIds":["a"],"queries":[]}',
      '{"version":1,"corpusDocIds":["a"],"queries":[{"id":"q","relevantDocIds":[],"rankedDocIds":[],"decision":"answer","decision":"abstain"}]}'
    ]) {
      assert.throws(() => parseDatasetJson(text), errorCode("DUPLICATE_JSON_PROPERTY"));
    }
  });

  it("rejects malformed encoding, lone surrogates, BOMs, syntax errors and excessive nesting", () => {
    const bytes = Buffer.concat([
      Buffer.from('{"version":1,"corpusDocIds":["'),
      Buffer.from([0xc3, 0x28]),
      Buffer.from('"],"queries":[]}')
    ]);
    assert.throws(() => parseDatasetJson(bytes), errorCode("INVALID_UTF8"));
    assert.throws(() => parseDatasetJson('\ud800'), errorCode("INVALID_UTF8"));
    assert.throws(() => parseDatasetJson('{"version":1,"corpusDocIds":["\\ud800"],"queries":[]}'), errorCode("INVALID_ID_CHARS"));
    assert.throws(() => parseDatasetJson(Buffer.from('\ufeff' + JSON.stringify(empty()))), errorCode("INVALID_JSON"));
    for (const bad of ["{", '{"version":1,}', "/* comment */ {}", "{} {}", "NaN"]) {
      assert.throws(() => parseDatasetJson(bad), errorCode("INVALID_JSON"));
    }
    assert.throws(() => parseDatasetJson(" \n\t"), errorCode("EMPTY_INPUT"));
    assert.throws(() => parseDatasetJson("[".repeat(9) + "0" + "]".repeat(9)), errorCode("JSON_DEPTH_EXCEEDED"));
    assert.throws(() => parseDatasetJson(42 as unknown as string), errorCode("INVALID_INPUT_TYPE"));
  });

  it("treats structural characters inside IDs as strings rather than nesting", () => {
    const source = empty();
    source.corpusDocIds = ['a"\\{[[[[[[[[[[[[[[[[[[[[[[['];
    assert.deepEqual(parseDatasetJson(JSON.stringify(source)), source);
  });
});

describe("data-only object API and cumulative limits", () => {
  it("rejects getters without invoking them, symbols, hidden unknown fields and sparse arrays", () => {
    let invoked = false;
    const getter = empty();
    Object.defineProperty(getter, "queries", { enumerable: true, get() { invoked = true; return []; } });
    assert.throws(() => validateDataset(getter), errorCode("NON_JSON_VALUE"));
    assert.equal(invoked, false);

    const symbol = empty();
    Object.defineProperty(symbol, Symbol("extra"), { value: true });
    assert.throws(() => validateDataset(symbol), errorCode("UNKNOWN_PROPERTY"));
    const hidden = empty();
    Object.defineProperty(hidden, "extra", { value: true });
    assert.throws(() => validateDataset(hidden), errorCode("UNKNOWN_PROPERTY"));
    const hiddenVersion = empty();
    Object.defineProperty(hiddenVersion, "version", { value: 1, enumerable: false });
    assert.throws(() => validateDataset(hiddenVersion), errorCode("NON_JSON_VALUE"));
    const sparse = single();
    delete sparse.queries[0].rankedDocIds[1];
    assert.throws(() => validateDataset(sparse), errorCode("NON_JSON_VALUE"));
    const arrayGetter = single();
    Object.defineProperty(arrayGetter.queries[0].rankedDocIds, "0", { enumerable: true, get() { invoked = true; return "a"; } });
    assert.throws(() => validateDataset(arrayGetter), errorCode("NON_JSON_VALUE"));
    assert.equal(invoked, false);
    const arrayExtra = empty();
    Object.defineProperty(arrayExtra.corpusDocIds, "toJSON", { value() { invoked = true; return []; } });
    assert.throws(() => validateDataset(arrayExtra), errorCode("UNKNOWN_PROPERTY"));
    assert.equal(invoked, false);
  });

  it("rejects inherited schemas, missing fields and non-data decisions without stringifying them", () => {
    assert.throws(() => validateDataset(Object.create(empty())), errorCode("INVALID_ROOT"));
    assert.throws(() => validateDataset({ corpusDocIds: ["a"], queries: [] }), errorCode("INVALID_VERSION"));
    assert.throws(() => validateDataset({ version: 1, corpusDocIds: ["a"] }), errorCode("INVALID_QUERIES"));
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    for (const decision of [circular, 1n, NaN, Infinity, null]) {
      const source = single();
      assert.throws(() => validateDataset({ ...source, queries: [{ ...source.queries[0], decision }] }), errorCode("INVALID_DECISION"));
    }
    for (const version of [NaN, Infinity, 1n, "1", null]) {
      assert.throws(() => validateDataset({ ...empty(), version }), errorCode("INVALID_VERSION"));
    }
    assert.throws(() => parseDatasetJson('{"version":1e400,"corpusDocIds":["a"],"queries":[]}'), errorCode("INVALID_VERSION"));
    assert.throws(() => parseDatasetJson('{"version":1,"corpusDocIds":["a"],"queries":[],"__proto__":{}}'), errorCode("UNKNOWN_PROPERTY"));
  });

  it("checks identifier length, whitespace, controls, Unicode and exact matching", () => {
    for (const id of ["", "x".repeat(129)]) {
      assert.throws(() => validateDataset({ ...empty(), corpusDocIds: [id] }), errorCode("INVALID_ID_LENGTH"));
    }
    for (const id of [" a", "a ", "\u00a0a", " \t"]) {
      assert.throws(() => validateDataset({ ...empty(), corpusDocIds: [id] }), errorCode("INVALID_ID_WHITESPACE"));
    }
    for (const id of ["a\u0000b", "a\u007fb", "a\ud800b", "a\udc00b"]) {
      assert.throws(() => validateDataset({ ...empty(), corpusDocIds: [id] }), errorCode("INVALID_ID_CHARS"));
    }
    assert.equal(validateDataset({ ...empty(), corpusDocIds: ["😀".repeat(64)] }).corpusDocIds[0].length, 128);
    const source = single();
    source.queries[0].rankedDocIds = ["A"];
    assert.throws(() => validateDataset(source), errorCode("UNKNOWN_RANKED_DOC_ID"));
    source.queries[0].rankedDocIds = ["a", "b", "c", "missing"];
    assert.throws(() => evaluateRetrieval(source, 1), errorCode("UNKNOWN_RANKED_DOC_ID"));
  });

  it("accepts count maxima, rejects excessive queries/relevance, and evaluates rank 1000", () => {
    const corpus = Array.from({ length: LIMITS.MAX_CORPUS_DOCS }, (_, i) => `d${i}`);
    assert.equal(validateDataset({ version: 1, corpusDocIds: corpus, queries: [] }).corpusDocIds.length, 10_000);
    const queries = Array.from({ length: LIMITS.MAX_QUERIES }, (_, i) => ({ id: `q${i}`, relevantDocIds: [], rankedDocIds: [], decision: "abstain" }));
    assert.equal(evaluateRetrieval({ ...empty(), queries }, 1).decision.accuracy, 1);
    assert.throws(() => validateDataset({ ...empty(), queries: [...queries, queries[0]] }), errorCode("QUERY_COUNT_OUT_OF_RANGE"));
    assert.throws(() => validateDataset({ ...empty(), queries: [{ id: "q", relevantDocIds: ["a", "a"], rankedDocIds: [], decision: "answer" }] }), errorCode("RELEVANT_COUNT_OUT_OF_RANGE"));
    const ranked = corpus.slice(0, 1000);
    const report = evaluateRetrieval({ version: 1, corpusDocIds: corpus, queries: [{ id: "last", relevantDocIds: ["d999"], rankedDocIds: ranked, decision: "answer" }] }, 1000);
    assert.equal(report.queries[0].firstRelevantRankAtK, 1000);
    assert.equal(report.retrieval.mrrAtK, 0.001);
    assert.equal(report.retrieval.recallAtK, 1);
  });

  it("bounds the object API cumulatively, not merely each individual list", () => {
    const corpus = Array.from({ length: 1000 }, (_, i) => `d${i}`);
    const source = {
      version: 1,
      corpusDocIds: corpus,
      queries: Array.from({ length: 200 }, (_, i) => ({ id: `q${i}`, relevantDocIds: corpus, rankedDocIds: [], decision: "answer" }))
    };
    assert.ok(Buffer.byteLength(JSON.stringify(source)) > LIMITS.MAX_INPUT_BYTES);
    assert.throws(() => validateDataset(source), errorCode("INPUT_TOO_LARGE"));
  });

  it("returns independent copies rather than retaining caller arrays", () => {
    const source = single();
    const validated = validateDataset(source);
    source.corpusDocIds.push("new");
    source.queries[0].relevantDocIds[0] = "a";
    source.queries[0].rankedDocIds.reverse();
    assert.deepEqual(validated.corpusDocIds, ["a", "b", "c"]);
    assert.deepEqual(validated.queries[0].relevantDocIds, ["c"]);
    assert.deepEqual(validated.queries[0].rankedDocIds, ["a", "b", "c"]);
  });
});

describe("bounded file loading", () => {
  it("handles exact-size, oversized, malformed, missing and non-regular files", (t) => {
    const directory = fs.mkdtempSync(path.join(tmpdir(), "retrieval-eval-test-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const file = path.join(directory, "synthetic.json");
    const json = JSON.stringify(empty());
    fs.writeFileSync(file, json + " ".repeat(LIMITS.MAX_INPUT_BYTES - Buffer.byteLength(json)));
    assert.deepEqual(loadDatasetFromFile(file), empty());
    fs.appendFileSync(file, " ");
    assert.throws(() => loadDatasetFromFile(file), errorCode("INPUT_TOO_LARGE"));
    fs.writeFileSync(file, Buffer.from([0xff]));
    assert.throws(() => loadDatasetFromFile(file), errorCode("INVALID_UTF8"));
    fs.writeFileSync(file, "{");
    assert.throws(() => loadDatasetFromFile(file), errorCode("INVALID_JSON"));
    assert.throws(() => loadDatasetFromFile(directory), errorCode("FILE_IO_ERROR"));
    assert.throws(() => loadDatasetFromFile(path.join(directory, "missing.json")), errorCode("FILE_IO_ERROR"));
    assert.throws(() => evaluateDatasetFile(file, 0), errorCode("OUT_OF_RANGE_K"));
  });
});
