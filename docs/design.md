# Design and rationale

## What is evaluated

Retrieval rankings and answer/abstain decisions are distinct labeled tasks. A relevant document can appear at rank 1 while the system abstains; a system can answer despite retrieving no relevant document. The evaluator therefore scores an answerable query's ranking regardless of the supplied decision, and scores every decision separately.

Unanswerable cases have empty relevant sets. They are not assigned zero recall: they are excluded from macro retrieval denominators. Null averages explicitly represent an absent population. This avoids division by zero and prevents changes in the number of unanswerable cases from silently changing retrieval averages. All four decision outcomes remain counted.

Only the first K ranked IDs affect retrieval metrics. All supplied IDs are nevertheless validated, including the suffix beyond K. This distinction prevents malformed suffixes from being hidden behind a small cutoff. Source hit is a binary retrieval hit, not a measure of generated-answer accuracy.

## Modules and trust boundaries

- `types.ts`: readonly public interfaces, version, frozen limits and `ValidationError`. TypeScript readonly declarations do not deep-freeze runtime reports.
- `validator.ts`: snapshots ordinary data properties without invoking accessors, checks the closed schema and memberships, copies arrays, and incrementally budgets compact bytes. A lexical JSON guard checks depth and duplicate member names, while native `JSON.parse` owns grammar validation. Fatal UTF-8 decoding prevents malformed bytes becoming replacement-character IDs.
- `evaluator.ts`: pure evaluation and aligned baseline/candidate comparison. Corpus order and query order must match for comparisons; relevant-label order need not match because relevance is a set.
- `reporter.ts`: deterministic full-precision JSON and rounded Markdown. Query IDs are entity-encoded for Markdown instead of being injected as report syntax. No document or question text is accepted in evaluation input or copied into output.
- `index.ts`: public exports and bounded, descriptor-based file reads. A file is opened once, checked with `fstat` and read only into a fixed 1 MiB + 1 buffer. Size metadata is an early rejection optimization, not the allocation boundary. The extra byte distinguishes exactly-at-limit input from an oversized file.
- `cli.ts`: strict option parsing, explicit exit codes and synchronous bounded-output writes that surface I/O failures. Diagnostics avoid raw invalid values and terminal control injection. No output files are created.
- `demo.ts`: compares the existing two fixed ranking files, asserts hand-calculated aggregates/deltas, and prints Markdown followed by comparison JSON.

The object API is intended for data, not executable adversarial JavaScript. Proxies can execute reflection traps; use the byte/text parser at untrusted data boundaries. Regular-file reads are synchronous and are not an atomic filesystem snapshot. A growing file cannot force an unbounded read, but a concurrently changed file may yield a rejected or mixed snapshot. Symlinks to regular files remain supported.

## Resource behavior

All byte, count and ID bounds are fixed and exported. Object inputs also receive an incremental compact JSON byte budget, so independent per-list limits cannot multiply into enormous accepted datasets. No recursive object walk or caller `toJSON` is needed. The raw JSON depth guard limits nesting before native parsing. Arrays are count-checked before their elements are copied.

For accepted data, validation work is linear in its bounded representation and reference count. Evaluation adds membership-set construction and at most K ranked inspections per query. Comparisons perform additional validation/evaluation passes on two independently bounded inputs; this favors a small coherent API over an unchecked fast path. Report size is bounded by the fixed query and ID limits. There are no timers, background jobs, network clients, persistent caches or telemetry.

## Fixtures and test strategy

`examples/synthetic-corpus.json` contains invented snippets and six manually labeled questions. Its two empty relevant sets intentionally ask about subjects absent from the corpus. It is contextual material rather than an accepted dataset schema; neither the evaluator nor demo loads its text. The two ranking files contain IDs and labels only. Tests check fixture alignment to prevent accidental label drift.

The existing hand-calculated tests cover rank 1, rank 3, misses, multiple relevant documents, short rankings, the K+1 boundary, abstention despite a hit, all decision combinations and null populations. Additional independent regression tests exercise:

- exact byte/count boundaries, Unicode byte lengths and rank 1000;
- invalid encoding, duplicate/escaped member names and hostile nesting;
- accessor side effects, hidden/symbol keys, sparse arrays and non-stringifiable invalid values;
- cumulative object resource limits and copied-array ownership;
- comparison population mismatches and null deltas;
- full-precision JSON versus four-decimal Markdown and malicious ID syntax;
- real child-process exit status, low-score success, malformed files and broken output callbacks;
- deterministic demo Markdown and parseable comparison JSON.

No performance benchmarks, statistical significance or deployment claims are inferred from these fixtures. Test commands are documented; review changes are not a claim that tests were executed in the review environment.

## Deliberate limitations

Only binary relevance, version 1 data, one cutoff per evaluation and bounded local JSON files are supported. There is no retrieval implementation, model/API dependency, answer-text evaluation, graded relevance, deduplication repair, confidence interval or automatic quality threshold. Human labels may be incomplete or incorrect. These metrics are not factuality, semantic truth, security, production-readiness or compliance guarantees.

## Background references

- [Stanford IR book: evaluation of ranked retrieval results](https://www-nlp.stanford.edu/IR-book/html/htmledition/evaluation-of-ranked-retrieval-results-1.html)
- [Node.js test runner](https://nodejs.org/api/test.html)
- [Official LOFRANO IA context](https://lofranotecnologia.com.br/servicos/inteligencia-artificial)

These links provide background only; no external content is required at runtime.
