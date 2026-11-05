import * as fs from "node:fs";
import { EvaluationReport, LIMITS, RetrievalDatasetInput, ValidationError } from "./types.js";
import { parseDatasetJson, validateK } from "./validator.js";
import { evaluateRetrieval } from "./evaluator.js";

export * from "./types.js";
export * from "./validator.js";
export * from "./evaluator.js";
export * from "./reporter.js";

function readBoundedRegularFile(filePath: string): Buffer {
  // O_NONBLOCK avoids waiting for a FIFO writer before fstat can reject it.
  // All checks and reads use the same descriptor, not a stat-then-reopen pair.
  const fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0));
  let failed = false;
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) {
      throw new ValidationError("FILE_IO_ERROR", "Dataset input must be a regular local file.");
    }
    if (stat.size > LIMITS.MAX_INPUT_BYTES) {
      throw new ValidationError("INPUT_TOO_LARGE", "Input file exceeds the 1 MiB byte limit.");
    }
    const buffer = Buffer.alloc(LIMITS.MAX_INPUT_BYTES + 1);
    let used = 0;
    while (used < buffer.length) {
      const count = fs.readSync(fd, buffer, used, Math.min(65_536, buffer.length - used), null);
      if (count === 0) break;
      used += count;
    }
    if (used > LIMITS.MAX_INPUT_BYTES) {
      throw new ValidationError("INPUT_TOO_LARGE", "Input file exceeds the 1 MiB byte limit.");
    }
    return buffer.subarray(0, used);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      fs.closeSync(fd);
    } catch (error) {
      if (!failed) throw error;
    }
  }
}

export function loadDatasetFromFile(filePath: string): RetrievalDatasetInput {
  if (typeof filePath !== "string" || filePath.length === 0 || filePath.length > 4096) {
    throw new ValidationError("FILE_IO_ERROR", "Dataset path must be a nonempty string of at most 4096 UTF-16 code units.");
  }
  let buffer: Buffer;
  try {
    buffer = readBoundedRegularFile(filePath);
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError("FILE_IO_ERROR", "Cannot open, read or close the dataset file.");
  }
  return parseDatasetJson(buffer);
}

export function evaluateDatasetFile(filePath: string, k: number): EvaluationReport {
  const cutoff = validateK(k);
  return evaluateRetrieval(loadDatasetFromFile(filePath), cutoff);
}
