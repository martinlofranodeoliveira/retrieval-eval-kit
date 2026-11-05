# Retrieval Eval Kit

An original offline TypeScript library and CLI for `Recall@K`, `MRR@K`, source hit rate (`HitRate@K`), and answer/abstain decisions on labeled retrieval cases. By [Lofrano Tecnologia](https://lofranotecnologia.com.br). The official [LOFRANO IA page](https://lofranotecnologia.com.br/servicos/inteligencia-artificial) provides organizational context, not evidence of evaluation results.

[Português](./README.pt-BR.md)

## Install, test and demo

Requires Node.js `>=22`. TypeScript and Node type declarations are development dependencies only; there are no runtime dependencies.

```bash
npm install
npm test
npm run demo
```

`npm test` compiles in strict mode before running `node --test`. After installation, tests and the demo require no network, models, embeddings, API keys or downloaded datasets. The demo writes only stdout and asserts fixed synthetic metric differences.

## CLI

```bash
npm run cli -- examples/retrieval.json --k 3 --format json
npm run cli -- examples/retrieval.json --k 3 --format markdown
```

For stdout containing only the report, without npm's script banners:

```bash
npm run build
node dist/src/cli.js examples/retrieval.json --k 3 --format json
```

The positional path can instead be supplied as `--input <path>`. JSON is the default; `md` aliases `markdown`. Options cannot be repeated. Use `--help` alone. A path beginning with `-` needs a `./` prefix. Exit status is `0` for valid evaluations or help and `2` for invalid usage, input or I/O. Low scores alone are not errors.

## Small library example

Compile before importing the package's JavaScript entry point:

```bash
npm run build
```

From an `.mjs` file in this repository:

```js
import { evaluateRetrieval, formatJsonReport } from './dist/src/index.js';

const report = evaluateRetrieval({
  version: 1,
  corpusDocIds: ['doc-1', 'doc-2'],
  queries: [{
    id: 'q-1',
    relevantDocIds: ['doc-2'],
    rankedDocIds: ['doc-1', 'doc-2'],
    decision: 'abstain'
  }]
}, 2);

console.log(report.retrieval.mrrAtK); // 0.5, despite the abstention
console.log(report.decision.falseAbstentionCount); // 1
process.stdout.write(formatJsonReport(report));
```

Package consumers can import the same exports from `retrieval-eval-kit`. Other entry points include `parseDatasetJson`, `validateDataset`, `loadDatasetFromFile`, `evaluateDatasetFile`, `compareRetrievalDatasets`, `formatMarkdownReport` and `formatComparisonMarkdown`. Validation failures throw `ValidationError` with a `code`. Caller arrays are never changed.

## Exact metric definitions

For each query, let `R` be its unique relevant IDs and `P` the first `min(K, rankedDocIds.length)` ranked IDs, with `K` a finite safe integer in `1..1000`.

For **answerable** queries (`R.length > 0`):

- `hits = |R ∩ P|`.
- `recallAtK = hits / R.length`.
- `reciprocalRankAtK = 1 / firstRelevantRank`, using a 1-based position in `P`, or `0` if no hit occurs.
- `hitAtK = 1` if `hits > 0`, otherwise `0`.

Aggregate `recallAtK`, `mrrAtK` and `hitRateAtK` are the respective unweighted arithmetic means over **answerable queries only**, regardless of supplied decisions. Unanswerable queries have null per-query retrieval metrics. If none are answerable, all three aggregate retrieval metrics are `null` and `answerableQueryCount` is `0`.

Decisions are evaluated separately over **every** query. Expected decision is `abstain` exactly when `R` is empty, otherwise `answer`. A false answer answers an unanswerable query; a false abstention abstains on an answerable one. Accuracy is `correctCount / totalQueries`, or `null` for zero queries. Empty query data therefore has null retrieval averages and null decision accuracy, not zero-valued averages.

JSON retains JavaScript's full binary64 numerical results; it does not provide arbitrary-precision rational arithmetic. Markdown displays floating metrics with `toFixed(4)` and nulls as `null`. Query order is preserved. Reports omit document text and question text. Markdown entity-encodes query-ID syntax characters rather than interpreting them as tables, links or HTML.

## Worked example

`examples/synthetic-corpus.json` contains ten invented snippets and six hand-labeled questions. It is contextual fixture material, **not** an evaluator input. Both ranking files use exactly those IDs and labels.

At `K=3`, `examples/retrieval.json` has:

| Query | Relevant count | Relevant ranks within K | Recall | RR | Hit |
| --- | --- | --- | --- | --- | --- |
| q-01 | 1 | 1 | 1 | 1 | 1 |
| q-02 | 2 | 2, 3 | 1 | 0.5 | 1 |
| q-03 | 2 | 1 | 0.5 | 1 | 1 |
| q-04 | 1 | none; relevant ID at rank 4 | 0 | 0 | 0 |
| q-05 | 0 | none | null | null | null |
| q-06 | 0 | none | null | null | null |

Thus Recall@3 is `(1 + 1 + 0.5 + 0)/4 = 0.625`; MRR@3 is `(1 + 0.5 + 1 + 0)/4 = 0.625`; HitRate@3 is `3/4 = 0.75`. The candidate's only incorrect decision is q-04, so accuracy is `5/6 = 0.8333333333333334` (`0.8333` in Markdown).

The demo's human-readable section is:

```text
# Retrieval Ranking Comparison (K = 3)

- **Corpus Size**: 10 | **Total Queries**: 6 (4 answerable, 2 unanswerable)

| Metric | Baseline | Candidate | Delta |
| --- | --- | --- | --- |
| Recall@3 | 0.3750 | 0.6250 | +0.2500 |
| MRR@3 | 0.1667 | 0.6250 | +0.4583 |
| HitRate@3 | 0.5000 | 0.7500 | +0.2500 |
| Decision Accuracy | 0.5000 | 0.8333 | +0.3333 |
| False Answers | 1 | 0 | -1 |
| False Abstentions | 2 | 1 | -1 |
```

It then prints a `Machine-Readable Comparison JSON` section with full-precision baseline, candidate and delta values. These differences are fixture arithmetic, not measured customer results or benchmarks.

## Design and limitations

The evaluator separates ranking quality from the decision gate: retrieval can succeed while a decision incorrectly abstains. Unanswerable cases are excluded from retrieval denominators to avoid conflating these two concerns. Explicit IDs and strict bounds keep the implementation small and offline.

Input is version 1 only: one strict JSON object, no unknown members, duplicate member names or duplicate IDs. Bounds include 1 MiB raw input, a 1 MiB compact validated representation even for object callers, 10,000 corpus IDs, 5,000 queries, 1,000 ranked IDs per query and 128 UTF-16 code units per ID. Files must be regular local files. See the complete [contract](./docs/contract.md), including encoding and comparison alignment rules.

This tool does **not** retrieve documents, inspect generated answers, assess semantic truth, answer factuality, hallucinations, security or production readiness, or provide an automatic quality guarantee. Its scores depend on the supplied labels. Binary relevance is the only supported labeling scheme. It supplies no confidence intervals or statistical significance tests. The object API is not a sandbox for executable JavaScript proxies. Concurrent file changes are not an atomic snapshot.

- [Design and rationale](./docs/design.md)
- [Contract and output fields](./docs/contract.md)
- [Contributing](./CONTRIBUTING.md)
- [Security reporting](./SECURITY.md)
- [Changelog](./CHANGELOG.md)

For general contact, use the [official homepage](https://lofranotecnologia.com.br).

MIT License. Copyright (c) 2026 Lofrano Tecnologia.
