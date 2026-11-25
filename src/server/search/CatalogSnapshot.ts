/**
 * Tool-catalog snapshot diffing.
 *
 * The search engine commits to its indexed catalog with a Merkle root
 * (`ToolMerkleWitness`). A root change alone says "something moved" but not
 * what: an extension reload, a mutated schema, or a reordered tool list all
 * collapse to a different 64-hex string. This module turns root drift into an
 * actionable report.
 *
 * Design notes (specialized, not a port of any single external tool):
 *  - classification uses the per-tool leaf hash, so it is exact and does not
 *    depend on parsing a byte stream;
 *  - only the mutated tools are diffed structurally, to produce a JSON-path
 *    like `$.inputSchema.properties.query.type`;
 *  - a byte offset is reported for mutated tools as a cheap "where does the
 *    serialized form diverge" hint, computed on canonical UTF-8 text.
 *
 * Payloads are metadata-only (tool names, field paths, truncated scalar
 * values) so the report is safe to emit on the event bus / diagnostics.
 */

import { compareCodeUnit, stableStringify } from './CanonicalJson';
import { hashToolLeaf, type ToolDescriptorForCommitment } from './ToolMerkleWitness';

/** Canonical descriptor committed to by the state root. */
export type CatalogToolDescriptor = ToolDescriptorForCommitment;

/** Minimal shape needed to build a descriptor from a `Tool`. */
export interface CatalogToolSource {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
}

export interface CatalogFieldChange {
  /** JSON path of the first differing leaf, e.g. `$.inputSchema.properties.x`. */
  readonly path: string;
  /** Truncated canonical value before the change. */
  readonly before: string;
  /** Truncated canonical value after the change. */
  readonly after: string;
}

export interface CatalogToolMutation {
  readonly name: string;
  /** First differing UTF-8 byte of the canonical descriptor, or null. */
  readonly byteOffset: number | null;
  readonly fields: readonly CatalogFieldChange[];
}

export interface CatalogChangeReport {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly mutated: readonly CatalogToolMutation[];
  /** True when any list was capped; the report is a sample, not the full set. */
  readonly truncated: boolean;
}

export interface CatalogChangeOptions {
  readonly maxMutated?: number;
  readonly maxFieldsPerTool?: number;
  readonly maxValueLength?: number;
  readonly maxListed?: number;
}

const DEFAULT_MAX_MUTATED = 20;
const DEFAULT_MAX_FIELDS_PER_TOOL = 5;
const DEFAULT_MAX_VALUE_LENGTH = 120;
const DEFAULT_MAX_LISTED = 50;

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function appendKey(path: string, key: string): string {
  return IDENTIFIER_RE.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

/**
 * First differing UTF-8 byte offset between two strings, or null when equal.
 * Comparing decoded Buffers keeps multi-byte characters from producing a
 * half-character "offset".
 */
export function findFirstByteDifference(before: string, after: string): number | null {
  const left = Buffer.from(before, 'utf8');
  const right = Buffer.from(after, 'utf8');
  const shared = Math.min(left.length, right.length);
  for (let i = 0; i < shared; i++) {
    if (left[i] !== right[i]) return i;
  }
  return left.length === right.length ? null : shared;
}

/**
 * First differing path between two JSON-like values.
 * Returns null when no difference is found.
 */
function firstDifferencePath(before: unknown, after: unknown, path: string): string | null {
  if (Object.is(before, after)) return null;
  if (before === null || after === null) return path;
  if (typeof before !== 'object' || typeof after !== 'object') return path;

  const beforeIsArray = Array.isArray(before);
  const afterIsArray = Array.isArray(after);
  if (beforeIsArray !== afterIsArray) return path;

  if (beforeIsArray && afterIsArray) {
    const shared = Math.min(before.length, after.length);
    for (let i = 0; i < shared; i++) {
      const child = firstDifferencePath(before[i], after[i], `${path}[${i}]`);
      if (child !== null) return child;
    }
    return before.length === after.length ? null : `${path}[${shared}]`;
  }

  const left = before as Record<string, unknown>;
  const right = after as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].toSorted(
    compareCodeUnit,
  );
  for (const key of keys) {
    const hasLeft = Object.prototype.hasOwnProperty.call(left, key);
    const hasRight = Object.prototype.hasOwnProperty.call(right, key);
    const childPath = appendKey(path, key);
    if (!hasLeft || !hasRight) return childPath;
    const child = firstDifferencePath(left[key], right[key], childPath);
    if (child !== null) return child;
  }
  return null;
}

function describeValue(value: unknown, maxLength: number): string {
  const text = stableStringify(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

interface MutationResult {
  readonly mutation: CatalogToolMutation;
  readonly fieldsTruncated: boolean;
}

function describeMutation(
  before: CatalogToolDescriptor,
  after: CatalogToolDescriptor,
  options: CatalogChangeOptions,
): MutationResult {
  const maxFields = options.maxFieldsPerTool ?? DEFAULT_MAX_FIELDS_PER_TOOL;
  const maxValueLength = options.maxValueLength ?? DEFAULT_MAX_VALUE_LENGTH;
  const fields: CatalogFieldChange[] = [];
  let fieldsTruncated = false;

  // `name` is the identity used for matching, so only the mutable fields are
  // diffed. Keep this list explicit: adding a committed field to
  // `hashToolLeaf` must add it here too, otherwise a mutation shows up as a
  // root change with an empty field list.
  const fieldNames = ['domain', 'description', 'inputSchema'] as const;
  for (const field of fieldNames) {
    const left = before[field];
    const right = after[field];
    if (stableStringify(left) === stableStringify(right)) continue;
    if (fields.length >= maxFields) {
      fieldsTruncated = true;
      break;
    }
    const path = firstDifferencePath(left, right, `$.${field}`) ?? `$.${field}`;
    fields.push({
      path,
      before: describeValue(left, maxValueLength),
      after: describeValue(right, maxValueLength),
    });
  }

  return {
    mutation: {
      name: after.name,
      byteOffset: findFirstByteDifference(stableStringify(before), stableStringify(after)),
      fields,
    },
    fieldsTruncated,
  };
}

/**
 * Build canonical descriptors from `Tool`-shaped objects plus a domain map.
 * Shared by the engine (commitment input) and the rebuild path (snapshot), so
 * both sides diff the exact same shape.
 */
export function buildCatalogDescriptors(
  tools: readonly CatalogToolSource[],
  domainByName: ReadonlyMap<string, string | null>,
): CatalogToolDescriptor[] {
  return tools.map((tool) => ({
    name: tool.name,
    domain: domainByName.get(tool.name) ?? null,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema,
  }));
}

/**
 * Classify the transition between two catalog snapshots.
 *
 * Order-independent: passing the same descriptors in a different order
 * produces an empty report. Callers decide whether an empty report is worth
 * announcing; a signature change caused purely by workflow-runtime state is
 * not a catalog change.
 */
export function describeCatalogChange(
  before: readonly CatalogToolDescriptor[],
  after: readonly CatalogToolDescriptor[],
  options: CatalogChangeOptions = {},
): CatalogChangeReport {
  const maxMutated = options.maxMutated ?? DEFAULT_MAX_MUTATED;
  const maxListed = options.maxListed ?? DEFAULT_MAX_LISTED;

  const beforeByName = new Map(before.map((tool) => [tool.name, tool] as const));
  const afterByName = new Map(after.map((tool) => [tool.name, tool] as const));

  const added: string[] = [];
  const removed: string[] = [];
  const mutations: MutationResult[] = [];

  for (const tool of after) {
    const previous = beforeByName.get(tool.name);
    if (!previous) {
      added.push(tool.name);
      continue;
    }
    if (hashToolLeaf(previous) !== hashToolLeaf(tool)) {
      mutations.push(describeMutation(previous, tool, options));
    }
  }
  for (const tool of before) {
    if (!afterByName.has(tool.name)) removed.push(tool.name);
  }

  added.sort(compareCodeUnit);
  removed.sort(compareCodeUnit);
  mutations.sort((left, right) => compareCodeUnit(left.mutation.name, right.mutation.name));

  const truncated =
    mutations.length > maxMutated ||
    added.length > maxListed ||
    removed.length > maxListed ||
    mutations.some((entry) => entry.fieldsTruncated);

  return {
    added: added.slice(0, maxListed),
    removed: removed.slice(0, maxListed),
    mutated: mutations.slice(0, maxMutated).map((entry) => entry.mutation),
    truncated,
  };
}
