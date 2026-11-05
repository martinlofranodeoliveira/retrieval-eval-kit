# Version 1 contract

## Inputs and bounds

`evaluateRetrieval(input: unknown, k: unknown)` and `validateDataset(input: unknown)` accept data-only JavaScript representations of this JSON shape:

```json
{
  "version": 1,
  "corpusDocIds": ["doc-1", "doc-2"],
  "queries": [
    {
      "id": "q-1",
      "relevantDocIds": ["doc-2"],
      "rankedDocIds": ["doc-1", "doc-2"],
      "decision": "answer"
    }
  ]
}
```

All displayed properties are required. No other root or query properties are allowed. `version` must be the numeric value `1`. There are no coercions or defaults in the dataset schema. IDs are compared exactly, case-sensitively, without Unicode normalization.

Exported `LIMITS`:

| Constant | Value | Meaning |
| --- | --- | --- |
| MAX_INPUT_BYTES | 1,048,576 | Raw JSON bytes and compact validated JSON bytes |
| MAX_JSON_DEPTH | 8 | Maximum nested object/array containers in raw JSON |
| MIN_CORPUS_DOCS | 1 | Minimum corpus count |
| MAX_CORPUS_DOCS | 10,000 | Maximum corpus count |
| MIN_QUERIES | 0 | Empty query arrays are accepted |
| MAX_QUERIES | 5,000 | Maximum query count |
| MAX_RANKED_DOCS_PER_QUERY | 1,000 | Maximum entire ranked list, not just its evaluated prefix |
| MIN_ID_LENGTH | 1 | Minimum UTF-16 code-unit length |
| MAX_ID_LENGTH | 128 | Maximum UTF-16 code-unit length |
| MIN_K | 1 | Minimum cutoff |
| MAX_K | 1,000 | Maximum cutoff |

`SCHEMA_VERSION` is exported separately as `1`. Relevant-list length cannot exceed corpus size. Empty relevant and ranked lists are accepted. Corpus IDs, query IDs, relevant IDs within a query, and ranked IDs within a query must each be unique in their respective scopes. Every relevant and ranked ID must belong to the corpus, including IDs beyond K. A document can be both relevant and ranked, and can be used by multiple queries.

IDs must be strings, must not be blank, and must not have leading/trailing whitespace as recognized by JavaScript `trim()`. They must contain paired Unicode surrogates and no ASCII controls U+0000–U+001F or U+007F. A supplementary Unicode character occupies two UTF-16 code units. Other characters are not normalized. Use non-sensitive IDs: reports contain query IDs.

`decision` must be exactly `answer` or `abstain`. K must be a finite safe integer in `1..1000`; numeric strings, fractions, NaN, infinities and unsafe integers are rejected by the library.

### JSON and object boundaries

`parseDatasetJson(string | Buffer)` enforces the raw UTF-8 byte limit before parsing. Buffers require valid UTF-8; malformed bytes are not replaced. String sources must be well-formed Unicode. BOMs, comments, trailing commas, multiple JSON values and duplicate object member names are rejected. Escaped equivalent member names count as duplicates. A lexical guard bounds nesting and detects duplicate names; native `JSON.parse` validates the JSON grammar. The accepted input is the documented version 1 subset, not an implementation of every JSON-related standard or extension.

The object API accepts plain objects with `Object.prototype` or null prototypes, own enumerable data properties, and dense arrays with own enumerable data elements. Accessors, sparse arrays, symbols, extra array properties and non-enumerable schema properties are rejected. Inherited schema fields do not satisfy required fields. Diagnostics never stringify arbitrary invalid objects. Validation returns new root/query objects and new arrays, without mutating or retaining caller arrays. It does not freeze the returned objects at runtime.

Both object and parsed inputs must fit a compact canonical representation of at most 1 MiB: `JSON.stringify`-style string escaping, no spaces, root fields in `version, corpusDocIds, queries` order and query fields in `id, relevantDocIds, rankedDocIds, decision` order. Size is accumulated incrementally from validated strings rather than serializing arbitrary caller objects. This prevents object callers from multiplying the per-list limits into tens of millions of accepted references. Raw input additionally includes its whitespace and escape spellings in the raw-byte check.

This API is a data validator, not a sandbox. JavaScript proxies can execute traps during reflection and are outside its resource/isolation guarantee. Parse bytes or text when crossing an untrusted data boundary.

### File reading

`loadDatasetFromFile(path: string)` accepts a nonempty path of at most 4096 UTF-16 code units. It follows symlinks to regular local files. It opens once, checks that descriptor with `fstat`, and reads at most `MAX_INPUT_BYTES + 1` bytes into a fixed-size buffer, even if size metadata is stale or the file grows. Non-regular files are rejected; nonblocking open is requested to avoid waiting on POSIX FIFOs. There is no directory enumeration, network fetch, stdin mode or file writing. This synchronous API can block on filesystem operations and does not promise an atomic snapshot of a concurrently modified file.

`evaluateDatasetFile(path: string, k: number)` validates K, loads and evaluates. Invalid K fails before file I/O.

## Evaluation output

`EvaluationReport` contains exactly these evaluator-produced fields:

| Field | Meaning |
| --- | --- |
| version | 1 |
| k | Validated cutoff |
| corpusSize | Declared corpus count |
| retrieval.answerableQueryCount | Number with nonempty relevant sets |
| retrieval.unanswerableQueryCount | Number with empty relevant sets |
| retrieval.recallAtK | Macro recall or null |
| retrieval.mrrAtK | Macro reciprocal rank or null |
| retrieval.hitRateAtK | Macro source hit or null |
| decision.totalQueries | All queries |
| decision.correctCount | Correct answer/abstain decisions |
| decision.accuracy | correctCount / totalQueries, or null |
| decision.falseAnswerCount | Expected abstain, actual answer |
| decision.falseAbstentionCount | Expected answer, actual abstain |
| decision.trueAnswerCount | Expected answer, actual answer |
| decision.trueAbstentionCount | Expected abstain, actual abstain |
| queries | Per-query results, in input order |

Each query result contains `id`, `answerable`, `relevantCount`, `rankedCount` (entire list), `evaluatedRankedCount` (min of ranked count and K), `relevantHitsAtK`, `firstRelevantRankAtK`, `recallAtK`, `reciprocalRankAtK`, `hitAtK`, `expectedDecision`, `actualDecision`, and `decisionCorrect`.

Let R be the relevant set, P the first K ranked IDs (or all returned IDs when fewer), h the size of their intersection, and r the 1-based position of the first relevant ID in P. For answerable queries:

- recall = h / |R|;
- reciprocal rank = 1/r when a hit exists, otherwise 0;
- hit = 1 when h > 0, otherwise 0.

An answerable query is evaluated even if its decision is `abstain`. Macro means sum each metric in input query order and divide by answerable query count; queries are equally weighted, not weighted by relevant-document count. Only P affects retrieval metrics, but all ranked IDs are validated. Appending an irrelevant ID after K changes `rankedCount`, not retrieval metrics.

For unanswerable queries the three per-query retrieval metrics are null; hit count is 0 and first relevant rank is null. With no answerable queries the three macro retrieval metrics are null and the answerable count is 0. With zero total queries decision accuracy is also null and all counts are 0. An empty relevant set means labeled unanswerability, not retrieval failure or a zero denominator to be scored as zero.

Expected decision is `abstain` only when R is empty. Decision metrics cover all queries independently of retrieved hits. They are not factuality or semantic-truth metrics.

## Reports and comparisons

`formatJsonReport(report)` emits pretty JSON with two-space indentation and a final LF, no timestamps and no extra rounding. Numbers are ordinary JavaScript binary64 results; serialization preserves their round-trip numerical values, not exact rational arithmetic.

`formatMarkdownReport(report)` emits deterministic Markdown with aggregate, decision and per-query tables, four decimal places via JavaScript `toFixed(4)` for floating metrics, integers for counts/ranks and literal `null` for nulls. Query order matches JSON. ID characters other than Unicode letters/numbers, spaces, dots and hyphens are encoded as numeric HTML entities. This keeps ID text out of Markdown/HTML syntax. Markdown is a report format, not a general-purpose HTML sanitizer. Document text, document ID lists and question text are omitted from both reports.

Formatters accept typed reports produced by this evaluator; they do not validate arbitrary or subsequently modified report objects. JSON is the authoritative machine representation; rounding can hide small differences in Markdown.

`compareRetrievalDatasets(baseline, candidate, k)` requires identical **ordered** corpus lists, identical query IDs in the same order, and identical relevant sets for each query (relevant-list order may differ). Rankings and decisions may differ. It rejects misalignment rather than silently matching/reordering populations. The comparison contains `k`, `corpusSize`, `totalQueries`, `answerableQueryCount`, `unanswerableQueryCount`, and `metrics`. Its metrics are `recallAtK`, `mrrAtK`, `hitRateAtK`, `decisionAccuracy`, `falseAnswerCount`, and `falseAbstentionCount`. Each contains `baseline`, `candidate`, and `delta = candidate - baseline`. A delta is null if either input metric is null; count deltas are always numbers. Positive error-count deltas mean more errors, not improvement. `formatComparisonMarkdown` formats these values deterministically; comparison JSON can be obtained with `JSON.stringify(comparison, null, 2)`.

## Errors and CLI

Validation failures throw `ValidationError`, whose `name` is `ValidationError` and whose `code` identifies the category. Message wording is diagnostic, not a stable parsing interface.

| Codes | Category |
| --- | --- |
| INVALID_INPUT_TYPE, INVALID_UTF8, EMPTY_INPUT, INVALID_JSON | Raw representation |
| INPUT_TOO_LARGE, JSON_DEPTH_EXCEEDED, DUPLICATE_JSON_PROPERTY | Raw/compact bounds or duplicate members |
| INVALID_ROOT, INVALID_QUERY_OBJECT, INVALID_VERSION | Schema objects/version |
| UNKNOWN_PROPERTY, NON_JSON_VALUE | Unknown keys or non-data object/array values |
| INVALID_CORPUS, CORPUS_COUNT_OUT_OF_RANGE | Corpus shape/count |
| INVALID_QUERIES, QUERY_COUNT_OUT_OF_RANGE | Query array shape/count |
| INVALID_RELEVANT_DOCS, RELEVANT_COUNT_OUT_OF_RANGE | Relevant array shape/count |
| INVALID_RANKED_DOCS, RANKED_COUNT_OUT_OF_RANGE | Ranked array shape/count |
| INVALID_ID_TYPE, INVALID_ID_LENGTH, INVALID_ID_WHITESPACE, INVALID_ID_CHARS | Identifier validation |
| DUPLICATE_CORPUS_DOC_ID, DUPLICATE_QUERY_ID, DUPLICATE_RELEVANT_DOC_ID, DUPLICATE_RANKED_DOC_ID | ID uniqueness |
| UNKNOWN_RELEVANT_DOC_ID, UNKNOWN_RANKED_DOC_ID | Corpus membership |
| INVALID_DECISION | Unsupported decision |
| INVALID_K, OUT_OF_RANGE_K | Cutoff validation |
| MISMATCHED_CORPUS, MISMATCHED_QUERIES, MISMATCHED_LABELS | Comparison alignment |
| FILE_IO_ERROR | File/path failures |
| CLI_USAGE | Command-line usage |

When an input has several errors, which one is reported first is not guaranteed. Nonfinite input values are never accepted in a valid dataset or K.

CLI: `retrieval-eval-kit <path> --k <digits> [--format json|markdown]`, with `--input <path>` as an alternative and `md` as a format alias. Decimal digits may have leading zeros, but exponent, signed and fractional spellings are rejected. Each argument is limited to 4096 UTF-16 code units and at most eight arguments are accepted. Duplicate options/paths and unknown options are errors. `-h`/`--help` must be used alone.

Exit 0 means a valid evaluation or help. Exit 2 means usage, schema, parse or I/O failure; low scores are not failures. The executable catches synchronous stdout failures, attempts a bounded single-line stderr diagnostic, and still returns 2 if stderr also fails. Partial output may have been written before an output failure. No successful JSON report is written for input validation failures. npm script banners are not part of the CLI report; invoke compiled JavaScript directly when consuming stdout as JSON.
