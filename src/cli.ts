#!/usr/bin/env node
import { writeSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { loadDatasetFromFile } from "./index.js";
import { evaluateRetrieval } from "./evaluator.js";
import { formatJsonReport, formatMarkdownReport } from "./reporter.js";
import { ValidationError } from "./types.js";
import { parseStrictKString } from "./validator.js";

export type OutputFormat = "json" | "markdown";

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

interface ParsedCliArgs {
  help: boolean;
  inputPath: string | null;
  k: number | null;
  format: OutputFormat;
}

const USAGE_TEXT = `Usage:
  retrieval-eval-kit <dataset.json> --k <1..1000> [--format json|markdown]

Options:
  --input <path>             Alternative to the positional dataset path
  --k <1..1000>              Required decimal rank cutoff
  --format <json|markdown>   Report format: json (default); md aliases markdown
  -h, --help                 Show help, used alone

Options may not be repeated. Prefix a path beginning with '-' with './'.
Exit codes: 0 valid evaluation/help; 2 usage, validation or I/O failure.
`;

function parseCliArgs(argv: readonly string[]): ParsedCliArgs {
  if (argv.length > 8 || argv.some((arg) => typeof arg !== "string" || arg.length > 4096)) {
    throw new ValidationError("CLI_USAGE", "Too many arguments or an argument exceeds 4096 UTF-16 code units.");
  }
  if (argv.length === 1 && (argv[0] === "-h" || argv[0] === "--help")) {
    return { help: true, inputPath: null, k: null, format: "json" };
  }
  let inputPath: string | null = null;
  let k: number | null = null;
  let format: OutputFormat = "json";
  let formatSeen = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--k") {
      if (k !== null) throw new ValidationError("CLI_USAGE", "Repeated --k option.");
      const next = argv[++i];
      if (next === undefined) throw new ValidationError("CLI_USAGE", "Missing value for --k.");
      k = parseStrictKString(next);
    } else if (arg === "--format") {
      if (formatSeen) throw new ValidationError("CLI_USAGE", "Repeated --format option.");
      formatSeen = true;
      const next = argv[++i];
      if (next === "json") format = "json";
      else if (next === "markdown" || next === "md") format = "markdown";
      else throw new ValidationError("CLI_USAGE", "Expected json or markdown after --format.");
    } else if (arg === "--input") {
      if (inputPath !== null) throw new ValidationError("CLI_USAGE", "Multiple input paths specified.");
      const next = argv[++i];
      if (next === undefined || next.length === 0 || next.startsWith("-")) {
        throw new ValidationError("CLI_USAGE", "Missing dataset path after --input.");
      }
      inputPath = next;
    } else if (arg.startsWith("-")) {
      throw new ValidationError("CLI_USAGE", "Unknown option or help combined with other arguments.");
    } else {
      if (inputPath !== null) throw new ValidationError("CLI_USAGE", "Multiple input paths specified.");
      inputPath = arg;
    }
  }
  return { help: false, inputPath, k, format };
}

function writeFd(fd: number, text: string): void {
  const bytes = Buffer.from(text, "utf8");
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(fd, bytes, offset, bytes.length - offset);
    if (written <= 0) throw new Error("Output write made no progress.");
    offset += written;
  }
}

function diagnostic(error: unknown): string {
  const line = error instanceof ValidationError
    ? `Error [${error.code}]: ${error.message}`
    : "Error [INTERNAL]: Evaluation or output failed.";
  const bounded = line.length > 1024 ? `${line.slice(0, 1024)} [truncated]` : line;
  return bounded.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu,
    (char) => `\\u{${char.codePointAt(0)?.toString(16)}}`) + "\n";
}

export function runCli(
  argv: readonly string[],
  io: CliIo = {
    stdout: (text) => writeFd(1, text),
    stderr: (text) => writeFd(2, text)
  }
): number {
  try {
    const parsed = parseCliArgs(argv);
    if (parsed.help) {
      io.stdout(USAGE_TEXT);
      return 0;
    }
    if (parsed.inputPath === null || parsed.inputPath.length === 0) {
      throw new ValidationError("CLI_USAGE", "Missing dataset file path.");
    }
    if (parsed.k === null) {
      throw new ValidationError("CLI_USAGE", "Missing required option --k <1..1000>.");
    }
    const report = evaluateRetrieval(loadDatasetFromFile(parsed.inputPath), parsed.k);
    io.stdout(parsed.format === "json" ? formatJsonReport(report) : formatMarkdownReport(report));
    return 0;
  } catch (error) {
    try {
      io.stderr(diagnostic(error));
    } catch {
      // A broken diagnostic stream must not turn an I/O failure into success
      // or cause an uncaught exception from the executable.
    }
    return 2;
  }
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) process.exitCode = runCli(process.argv.slice(2));
