import * as assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  compareRetrievalDatasets,
  evaluateRetrieval,
  formatComparisonMarkdown,
  formatJsonReport,
  formatMarkdownReport,
  loadDatasetFromFile,
  ValidationError
} from "../src/index.js";
import { runCli } from "../src/cli.js";
import { runDemo } from "../src/demo.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));

function labels() {
  return {
    version: 1,
    corpusDocIds: ["a", "b", "c"],
    queries: [
      { id: "q", relevantDocIds: ["a", "c"], rankedDocIds: ["b", "c"], decision: "abstain" },
      { id: "u", relevantDocIds: [], rankedDocIds: [], decision: "answer" }
    ]
  };
}

function errorCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof ValidationError && error.code === code;
}

describe("comparison contract", () => {
  it("compares identical labels, accepts relevant-set reordering and never mutates inputs", () => {
    const baseline = labels();
    const candidate = labels();
    candidate.queries[0].relevantDocIds.reverse();
    candidate.queries[0].rankedDocIds = ["a", "c"];
    candidate.queries[0].decision = "answer";
    candidate.queries[1].decision = "abstain";
    const before = JSON.stringify([baseline, candidate]);
    const result = compareRetrievalDatasets(baseline, candidate, 2);
    assert.deepEqual(result.metrics.recallAtK, { baseline: 0.5, candidate: 1, delta: 0.5 });
    assert.deepEqual(result.metrics.mrrAtK, { baseline: 0.5, candidate: 1, delta: 0.5 });
    assert.deepEqual(result.metrics.hitRateAtK, { baseline: 1, candidate: 1, delta: 0 });
    assert.deepEqual(result.metrics.decisionAccuracy, { baseline: 0, candidate: 1, delta: 1 });
    assert.deepEqual(result.metrics.falseAnswerCount, { baseline: 1, candidate: 0, delta: -1 });
    assert.deepEqual(result.metrics.falseAbstentionCount, { baseline: 1, candidate: 0, delta: -1 });
    assert.equal(JSON.stringify([baseline, candidate]), before);
    assert.equal(formatComparisonMarkdown(result), formatComparisonMarkdown(compareRetrievalDatasets(baseline, candidate, 2)));
    assert.match(formatComparisonMarkdown(result), /\| Decision Accuracy \| 0\.0000 \| 1\.0000 \| \+1\.0000 \|/);
  });

  it("rejects corpus, query and label mismatches rather than comparing unlike populations", () => {
    const baseline = labels();
    const shorterCorpus = labels();
    shorterCorpus.corpusDocIds.pop();
    shorterCorpus.queries[0].relevantDocIds = ["a"];
    shorterCorpus.queries[0].rankedDocIds = ["b"];
    assert.throws(() => compareRetrievalDatasets(baseline, shorterCorpus, 2), errorCode("MISMATCHED_CORPUS"));
    const reorderedCorpus = labels();
    reorderedCorpus.corpusDocIds.reverse();
    assert.throws(() => compareRetrievalDatasets(baseline, reorderedCorpus, 2), errorCode("MISMATCHED_CORPUS"));
    const fewerQueries = labels();
    fewerQueries.queries.pop();
    assert.throws(() => compareRetrievalDatasets(baseline, fewerQueries, 2), errorCode("MISMATCHED_QUERIES"));
    const reorderedQueries = labels();
    reorderedQueries.queries.reverse();
    assert.throws(() => compareRetrievalDatasets(baseline, reorderedQueries, 2), errorCode("MISMATCHED_QUERIES"));
    for (const relevant of [["a"], ["a", "b"]]) {
      const changed = labels();
      changed.queries[0].relevantDocIds = relevant;
      assert.throws(() => compareRetrievalDatasets(baseline, changed, 2), errorCode("MISMATCHED_LABELS"));
    }
  });

  it("preserves nulls in empty and all-unanswerable comparisons", () => {
    const empty = { version: 1, corpusDocIds: ["a"], queries: [] };
    const result = compareRetrievalDatasets(empty, empty, 1);
    for (const metric of [result.metrics.recallAtK, result.metrics.mrrAtK, result.metrics.hitRateAtK, result.metrics.decisionAccuracy]) {
      assert.deepEqual(metric, { baseline: null, candidate: null, delta: null });
    }
    assert.deepEqual(result.metrics.falseAnswerCount, { baseline: 0, candidate: 0, delta: 0 });
    assert.match(formatComparisonMarkdown(result), /\| Recall@1 \| null \| null \| null \|/);
    const unanswerable = { ...empty, queries: [{ id: "u", relevantDocIds: [], rankedDocIds: [], decision: "abstain" }] };
    const all = compareRetrievalDatasets(unanswerable, unanswerable, 1);
    assert.deepEqual(all.metrics.recallAtK, { baseline: null, candidate: null, delta: null });
    assert.deepEqual(all.metrics.decisionAccuracy, { baseline: 1, candidate: 1, delta: 0 });
  });
});

describe("report precision and untrusted identifiers", () => {
  it("keeps a third-position reciprocal rank unrounded in JSON and rounds only Markdown", () => {
    const source = { version: 1, corpusDocIds: ["a", "b", "c"], queries: [{ id: "third", relevantDocIds: ["c"], rankedDocIds: ["a", "b", "c"], decision: "answer" }] };
    const report = evaluateRetrieval(source, 3);
    const json = formatJsonReport(report);
    const markdown = formatMarkdownReport(report);
    const parsed = JSON.parse(json);
    assert.equal(parsed.retrieval.mrrAtK, 1 / 3);
    assert.equal(parsed.queries[0].reciprocalRankAtK, 1 / 3);
    assert.ok(json.includes("0.3333333333333333"));
    assert.match(markdown, /\| MRR@3 \| 0\.3333 \|/);
    assert.ok(markdown.includes("| third | true | 1 | 1 | 3 | 1.0000 | 0.3333 | 1.0000 | answer | answer | true |"));
    assert.equal(json, formatJsonReport(evaluateRetrieval(source, 3)));
    assert.equal(markdown, formatMarkdownReport(evaluateRetrieval(source, 3)));
  });

  it("prevents table, link, entity and HTML injection while preserving JSON query IDs", () => {
    const id = 'q|<img src=x onerror=alert(1)>[x](https://invalid.example)`&amp;\\\u2028tail';
    const report = evaluateRetrieval({ version: 1, corpusDocIds: ["a"], queries: [{ id, relevantDocIds: [], rankedDocIds: [], decision: "abstain" }] }, 1);
    const markdown = formatMarkdownReport(report);
    const row = markdown.split("\n").find((line) => line.startsWith("| q&#124;"));
    assert.ok(row);
    assert.equal(row.split("|").length, 13);
    assert.ok(row.includes("&#60;img"));
    assert.ok(row.includes("&#91;x&#93;"));
    assert.ok(row.includes("&#38;amp&#59;"));
    assert.ok(row.includes("&#8232;"));
    assert.ok(!markdown.includes("<img"));
    assert.ok(!markdown.includes("[x]("));
    assert.equal(JSON.parse(formatJsonReport(report)).queries[0].id, id);
  });

  it("renders nulls without NaN, Infinity or invented zero retrieval averages", () => {
    const report = evaluateRetrieval({ version: 1, corpusDocIds: ["a"], queries: [] }, 1);
    const md = formatMarkdownReport(report);
    assert.match(md, /\| Recall@1 \| null \|/);
    assert.match(md, /\| MRR@1 \| null \|/);
    assert.match(md, /\| HitRate@1 \| null \|/);
    assert.match(md, /\| Correct \/ Total \| 0 \/ 0 \|/);
    assert.match(md, /\| Accuracy \| null \|/);
    assert.ok(!/NaN|Infinity/.test(md + formatJsonReport(report)));
  });
});

describe("executable behavior and synthetic fixture provenance", () => {
  it("rejects ambiguous/repeated flags and handles broken output streams", () => {
    for (const argv of [
      ["file.json", "--k", "1", "--k", "2"],
      ["file.json", "--k", "1", "--format", "json", "--format", "md"],
      ["file.json", "--input", "other.json", "--k", "1"],
      ["--help", "file.json"],
      ["--input", "--k", "1"],
      ["file.json", "--k", "1e2"],
      ["file.json", "--k", " 3"],
      ["file.json", "--k", "+3"],
      ["x".repeat(4097)]
    ]) {
      let out = "";
      let error = "";
      assert.equal(runCli(argv, { stdout: (s) => { out += s; }, stderr: (s) => { error += s; } }), 2);
      assert.equal(out, "");
      assert.ok(error.startsWith("Error ["));
    }
    assert.equal(runCli(["--help"], { stdout: () => { throw new Error("broken stream"); }, stderr: () => { throw new Error("also broken"); } }), 2);
    let help = "";
    assert.equal(runCli(["--help"], { stdout: (s) => { help += s; }, stderr: () => assert.fail("unexpected diagnostic") }), 0);
    assert.match(help, /Usage:/);
  });

  it("checks actual process exit status, clean JSON stdout and low-score success", (t) => {
    const directory = fs.mkdtempSync(path.join(tmpdir(), "retrieval-eval-cli-test-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const file = path.join(directory, "synthetic.json");
    fs.writeFileSync(file, JSON.stringify({ version: 1, corpusDocIds: ["a", "b"], queries: [{ id: "miss", relevantDocIds: ["b"], rankedDocIds: ["a"], decision: "answer" }] }));
    const good = spawnSync(process.execPath, [cliPath, file, "--k", "1"], { encoding: "utf8", timeout: 5000, maxBuffer: 8 * 1024 * 1024 });
    assert.ifError(good.error);
    assert.equal(good.status, 0);
    assert.equal(good.stderr, "");
    assert.equal(JSON.parse(good.stdout).retrieval.recallAtK, 0);
    fs.writeFileSync(file, "{");
    const bad = spawnSync(process.execPath, [cliPath, file, "--k", "1"], { encoding: "utf8", timeout: 5000, maxBuffer: 8 * 1024 * 1024 });
    assert.ifError(bad.error);
    assert.equal(bad.status, 2);
    assert.equal(bad.stdout, "");
    assert.match(bad.stderr, /Error \[INVALID_JSON\]/);
  });

  it("checks that both rankings share the checked-in hand labels and omit document/question text", () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(root, "examples", "synthetic-corpus.json"), "utf8")) as {
      synthetic: boolean;
      documents: { id: string; text: string }[];
      questions: { id: string; question: string; relevantDocIds: string[] }[];
    };
    assert.equal(fixture.synthetic, true);
    assert.equal(fixture.documents.length, 10);
    assert.equal(fixture.questions.length, 6);
    for (const name of ["retrieval.json", "retrieval-baseline.json"]) {
      const dataset = loadDatasetFromFile(path.join(root, "examples", name));
      assert.deepEqual(dataset.corpusDocIds, fixture.documents.map((d) => d.id));
      assert.deepEqual(dataset.queries.map((q) => ({ id: q.id, relevantDocIds: q.relevantDocIds })), fixture.questions.map((q) => ({ id: q.id, relevantDocIds: q.relevantDocIds })));
      const report = evaluateRetrieval(dataset, 3);
      const text = formatJsonReport(report) + formatMarkdownReport(report);
      for (const doc of fixture.documents) assert.ok(!text.includes(doc.text));
      for (const question of fixture.questions) assert.ok(!text.includes(question.question));
    }
  });

  it("emits deterministic human-readable and parseable machine-readable demo comparisons", () => {
    let first = "";
    let second = "";
    runDemo((s) => { first += s; });
    runDemo((s) => { second += s; });
    assert.equal(first, second);
    const marker = "\n## Machine-Readable Comparison JSON\n\n";
    const start = first.indexOf(marker);
    assert.ok(start > 0);
    const comparison = JSON.parse(first.slice(start + marker.length));
    assert.deepEqual(comparison.metrics.recallAtK, { baseline: 0.375, candidate: 0.625, delta: 0.25 });
    assert.ok(Math.abs(comparison.metrics.mrrAtK.delta - 11 / 24) < 1e-15);
  });
});
