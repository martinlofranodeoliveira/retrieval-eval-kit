import { TextDecoder } from "node:util";
import {
  Decision,
  LIMITS,
  QueryCaseInput,
  RetrievalDatasetInput,
  SCHEMA_VERSION,
  ValidationError
} from "./types.js";

const ROOT_ALLOWED_KEYS = new Set(["version", "corpusDocIds", "queries"]);
const QUERY_ALLOWED_KEYS = new Set(["id", "relevantDocIds", "rankedDocIds", "decision"]);
const CONTROL_CHAR_REGEX = /[\x00-\x1f\x7f]/;

function dataObject(
  value: unknown,
  allowed: ReadonlySet<string>,
  invalidCode: string,
  context: string
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError(invalidCode, `${context} must be a plain JSON object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ValidationError(invalidCode, `${context} must be a plain JSON object.`);
  }
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      throw new ValidationError("UNKNOWN_PROPERTY", `Unknown property at ${context}.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new ValidationError("NON_JSON_VALUE", `${context} must contain enumerable data properties only.`);
    }
    result[key] = descriptor.value;
  }
  return result;
}

function dataArray(
  value: unknown,
  minimum: number,
  maximum: number,
  invalidCode: string,
  countCode: string,
  context: string
): unknown[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(invalidCode, `${context} must be an array.`);
  }
  if (value.length < minimum || value.length > maximum) {
    throw new ValidationError(countCode, `${context} count must be in ${minimum}..${maximum}.`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (
      typeof key !== "string" ||
      !/^(0|[1-9][0-9]*)$/.test(key) ||
      Number(key) >= value.length
    ) {
      throw new ValidationError("UNKNOWN_PROPERTY", `Unknown array property at ${context}.`);
    }
  }
  const result: unknown[] = [];
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new ValidationError("NON_JSON_VALUE", `${context} must be a dense array of enumerable data elements.`);
    }
    result.push(descriptor.value);
  }
  return result;
}

function hasPairedSurrogates(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i++;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

class ByteBudget {
  private used = 0;

  public text(text: string): void {
    this.used += Buffer.byteLength(text, "utf8");
    if (this.used > LIMITS.MAX_INPUT_BYTES) {
      throw new ValidationError("INPUT_TOO_LARGE", "Compact validated dataset exceeds the 1 MiB byte limit.");
    }
  }

  public string(value: string): void {
    // Called only for bounded, validated strings: no caller toJSON methods run.
    this.text(JSON.stringify(value));
  }
}

export function validateK(k: unknown): number {
  if (typeof k !== "number" || !Number.isFinite(k) || !Number.isSafeInteger(k)) {
    throw new ValidationError("INVALID_K", "Parameter K must be a finite safe integer in 1..1000.");
  }
  if (k < LIMITS.MIN_K || k > LIMITS.MAX_K) {
    throw new ValidationError("OUT_OF_RANGE_K", "Parameter K must be between 1 and 1000 inclusive.");
  }
  return k;
}

export function parseStrictKString(raw: string): number {
  if (typeof raw !== "string" || raw.length > 4096 || !/^[0-9]+$/.test(raw)) {
    throw new ValidationError("INVALID_K", "CLI option --k must contain decimal digits representing an integer in 1..1000.");
  }
  return validateK(Number(raw));
}

function validateIdentifier(value: unknown, context: string): string {
  if (typeof value !== "string") {
    throw new ValidationError("INVALID_ID_TYPE", `${context} must be a string.`);
  }
  if (value.length < LIMITS.MIN_ID_LENGTH || value.length > LIMITS.MAX_ID_LENGTH) {
    throw new ValidationError("INVALID_ID_LENGTH", `${context} length must be in 1..128 UTF-16 code units.`);
  }
  if (value.trim() !== value || value.trim().length === 0) {
    throw new ValidationError("INVALID_ID_WHITESPACE", `${context} must not be blank or contain leading/trailing whitespace.`);
  }
  if (CONTROL_CHAR_REGEX.test(value) || !hasPairedSurrogates(value)) {
    throw new ValidationError("INVALID_ID_CHARS", `${context} must contain well-formed Unicode without ASCII control characters.`);
  }
  return value;
}

function validateDecision(value: unknown): Decision {
  if (value !== "answer" && value !== "abstain") {
    throw new ValidationError("INVALID_DECISION", "Query decision must be answer or abstain.");
  }
  return value;
}

// This is a lexical guard, not a replacement JSON parser. JSON.parse below
// remains responsible for the full JSON grammar. Braces inside strings and
// escaped quotes do not affect nesting; decoded member names detect aliases.
function checkJsonStructure(text: string): void {
  const stack: (Set<string> | null)[] = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      let end = i + 1;
      while (end < text.length) {
        if (text[end] === "\\") end += 2;
        else if (text[end] === '"') break;
        else end++;
      }
      if (end >= text.length) return;
      let next = end + 1;
      while (next < text.length && /[ \t\r\n]/.test(text[next])) next++;
      const keys = stack.at(-1);
      if (text[next] === ":" && keys instanceof Set) {
        let key: unknown;
        try {
          key = JSON.parse(text.slice(i, end + 1));
        } catch {
          return;
        }
        if (typeof key === "string") {
          if (keys.has(key)) {
            throw new ValidationError("DUPLICATE_JSON_PROPERTY", "JSON object member names must be unique, including escaped spellings.");
          }
          keys.add(key);
        }
      }
      i = end;
    } else if (char === "{" || char === "[") {
      if (stack.length >= LIMITS.MAX_JSON_DEPTH) {
        throw new ValidationError("JSON_DEPTH_EXCEEDED", "JSON nesting exceeds the maximum depth of 8 containers.");
      }
      stack.push(char === "{" ? new Set<string>() : null);
    } else if (char === "}" || char === "]") {
      stack.pop();
    }
  }
}

export function parseDatasetJson(rawJson: string | Buffer): RetrievalDatasetInput {
  if (typeof rawJson !== "string" && !Buffer.isBuffer(rawJson)) {
    throw new ValidationError("INVALID_INPUT_TYPE", "JSON input must be a string or Buffer.");
  }
  const byteLength = typeof rawJson === "string" ? Buffer.byteLength(rawJson, "utf8") : rawJson.byteLength;
  if (byteLength > LIMITS.MAX_INPUT_BYTES) {
    throw new ValidationError("INPUT_TOO_LARGE", "Raw JSON exceeds the 1 MiB byte limit.");
  }
  let text: string;
  if (typeof rawJson === "string") {
    text = rawJson;
    if (!hasPairedSurrogates(text)) {
      throw new ValidationError("INVALID_UTF8", "JSON text must be well-formed Unicode.");
    }
  } else {
    try {
      // Preserve a BOM so JSON.parse rejects it rather than silently stripping it.
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(rawJson);
    } catch {
      throw new ValidationError("INVALID_UTF8", "JSON bytes must be valid UTF-8.");
    }
  }
  if (text.trim().length === 0) {
    throw new ValidationError("EMPTY_INPUT", "Input JSON must not be empty.");
  }
  checkJsonStructure(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ValidationError("INVALID_JSON", "Input is not valid JSON; comments, trailing commas and BOMs are not supported.");
  }
  return validateDataset(parsed);
}

export function validateDataset(input: unknown): RetrievalDatasetInput {
  const root = dataObject(input, ROOT_ALLOWED_KEYS, "INVALID_ROOT", "Dataset root");
  if (root.version !== SCHEMA_VERSION) {
    throw new ValidationError("INVALID_VERSION", "Dataset version must be 1.");
  }
  const budget = new ByteBudget();
  budget.text('{"version":1,"corpusDocIds":[');
  const rawCorpus = dataArray(root.corpusDocIds, LIMITS.MIN_CORPUS_DOCS, LIMITS.MAX_CORPUS_DOCS, "INVALID_CORPUS", "CORPUS_COUNT_OUT_OF_RANGE", "corpusDocIds");
  const corpusSet = new Set<string>();
  const corpusDocIds: string[] = [];
  for (let i = 0; i < rawCorpus.length; i++) {
    const docId = validateIdentifier(rawCorpus[i], `corpusDocIds[${i}]`);
    if (corpusSet.has(docId)) {
      throw new ValidationError("DUPLICATE_CORPUS_DOC_ID", "Duplicate document ID in corpusDocIds.");
    }
    if (i > 0) budget.text(",");
    budget.string(docId);
    corpusSet.add(docId);
    corpusDocIds.push(docId);
  }
  budget.text('],"queries":[');
  const rawQueries = dataArray(root.queries, LIMITS.MIN_QUERIES, LIMITS.MAX_QUERIES, "INVALID_QUERIES", "QUERY_COUNT_OUT_OF_RANGE", "queries");
  const queryIdSet = new Set<string>();
  const queries: QueryCaseInput[] = [];
  for (let i = 0; i < rawQueries.length; i++) {
    const query = dataObject(rawQueries[i], QUERY_ALLOWED_KEYS, "INVALID_QUERY_OBJECT", `queries[${i}]`);
    const queryId = validateIdentifier(query.id, `queries[${i}].id`);
    if (queryIdSet.has(queryId)) {
      throw new ValidationError("DUPLICATE_QUERY_ID", "Duplicate query ID in queries.");
    }
    queryIdSet.add(queryId);
    if (i > 0) budget.text(",");
    budget.text('{"id":');
    budget.string(queryId);
    budget.text(',"relevantDocIds":[');
    const rawRelevant = dataArray(query.relevantDocIds, 0, corpusDocIds.length, "INVALID_RELEVANT_DOCS", "RELEVANT_COUNT_OUT_OF_RANGE", `queries[${i}].relevantDocIds`);
    const relevantSet = new Set<string>();
    const relevantDocIds: string[] = [];
    for (let j = 0; j < rawRelevant.length; j++) {
      const docId = validateIdentifier(rawRelevant[j], `queries[${i}].relevantDocIds[${j}]`);
      if (relevantSet.has(docId)) {
        throw new ValidationError("DUPLICATE_RELEVANT_DOC_ID", "Duplicate document ID in relevantDocIds.");
      }
      if (!corpusSet.has(docId)) {
        throw new ValidationError("UNKNOWN_RELEVANT_DOC_ID", "relevantDocIds references a document outside the corpus.");
      }
      if (j > 0) budget.text(",");
      budget.string(docId);
      relevantSet.add(docId);
      relevantDocIds.push(docId);
    }
    budget.text('],"rankedDocIds":[');
    const rawRanked = dataArray(query.rankedDocIds, 0, LIMITS.MAX_RANKED_DOCS_PER_QUERY, "INVALID_RANKED_DOCS", "RANKED_COUNT_OUT_OF_RANGE", `queries[${i}].rankedDocIds`);
    const rankedSet = new Set<string>();
    const rankedDocIds: string[] = [];
    for (let j = 0; j < rawRanked.length; j++) {
      const docId = validateIdentifier(rawRanked[j], `queries[${i}].rankedDocIds[${j}]`);
      if (rankedSet.has(docId)) {
        throw new ValidationError("DUPLICATE_RANKED_DOC_ID", "Duplicate document ID in rankedDocIds.");
      }
      if (!corpusSet.has(docId)) {
        throw new ValidationError("UNKNOWN_RANKED_DOC_ID", "rankedDocIds references a document outside the corpus.");
      }
      if (j > 0) budget.text(",");
      budget.string(docId);
      rankedSet.add(docId);
      rankedDocIds.push(docId);
    }
    const decision = validateDecision(query.decision);
    budget.text('],"decision":');
    budget.string(decision);
    budget.text("}");
    queries.push({ id: queryId, relevantDocIds, rankedDocIds, decision });
  }
  budget.text("]}");
  return { version: SCHEMA_VERSION, corpusDocIds, queries };
}
