# Changelog

## [Unreleased] - 0.1.0

### Added

- Strict version 1 offline TypeScript evaluator and CLI with no runtime dependencies.
- Per-answerable-query Recall@K, reciprocal rank and source hit, with unweighted macro aggregates and explicit null populations.
- Separate answer/abstain accuracy and all four decision counts across every query.
- Deterministic JSON, Markdown and aligned ranking comparisons.
- Synthetic ranking fixtures, contextual corpus snippets and hand-labeled questions.
- Offline comparison demo with asserted fixture arithmetic and human/machine-readable output.
- Hand-calculated, adversarial, comparison, report and executable regression tests.
- English and Portuguese documentation, MIT license and read-only CI.

### Fixed during contract review

- File loading now uses one checked descriptor and a fixed-size bounded read, including when file-size metadata becomes stale.
- Raw parsing rejects malformed UTF-8, duplicate JSON members (including escaped equivalent names), unpaired source surrogates and excessive nesting.
- Object validation rejects accessors, hidden/symbol properties, extra array properties and sparse arrays without invoking ordinary getters or caller serializers.
- An incremental compact byte budget also bounds direct object callers; invalid decisions no longer trigger arbitrary JSON serialization in diagnostics.
- Markdown query IDs are encoded to prevent table, link and HTML syntax injection.
- Duplicate CLI options are rejected, stdout I/O failures return exit 2, and failed stderr writes do not escape the CLI error handler.
- Security reporting now points to GitHub private vulnerability reporting rather than general contact.
