/**
 * Shared types, constants, and utility functions for sourcemap domain.
 */

import type { CodeCollector } from '@server/domains/shared/modules/collector';

export type JsonRecord = Record<string, unknown>;

export interface TextToolResponse {
  content: Array<{ type: 'text'; text: string }>;
}

export interface CdpSessionLike {
  send(method: string, params?: JsonRecord): Promise<unknown>;
  on?(event: string, listener: (params: unknown) => void): void;
  off?(event: string, listener: (params: unknown) => void): void;
  detach?(): Promise<void>;
}

export interface SourceMapV3 {
  version: 3;
  sources: string[];
  sourcesContent?: Array<string | null>;
  mappings: string;
  names: string[];
  sourceRoot?: string;
}

/**
 * An indexed source map (v3 `sections` form), produced by webpack code-splitting,
 * Rollup, and Closure Compiler. Each section pins an embedded v3 map at a
 * generated (line, column) offset. `flattenIndexedSourceMap` merges sections into
 * a single flat v3 map with offset-remapped mappings.
 */
export interface SourceMapSection {
  offset: { line: number; column: number };
  map: SourceMapV3;
}

export interface IndexedSourceMap {
  version: 3;
  file?: string;
  sections: SourceMapSection[];
}

export function isIndexedSourceMap(value: unknown): value is IndexedSourceMap {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as JsonRecord;
  return record['version'] === 3 && Array.isArray(record['sections']);
}

export interface DecodedMapping {
  generatedLine: number;
  generatedColumn: number;
  sourceIndex?: number;
  originalLine?: number;
  originalColumn?: number;
  nameIndex?: number;
}

export interface ParsedSourceMapResult {
  resolvedUrl: string;
  map: SourceMapV3;
  mappings: DecodedMapping[];
  mappingsCount: number;
  segmentCount: number;
}

export interface DiscoverItem {
  scriptUrl: string;
  sourceMapUrl: string;
  isInline: boolean;
  scriptId: string;
}

export interface MutableDiscoverItem extends DiscoverItem {}

export interface ExtensionTarget {
  targetId: string;
  extensionId: string;
  name: string;
  type: 'service_worker' | 'background_page';
  url: string;
}

export interface SourcemapSharedState {
  collector: CodeCollector;
}

const VlqConstant = {
  BASE_SHIFT: 5,
  BASE: 1 << 5, // 1 << BASE_SHIFT
  BASE_MASK: (1 << 5) - 1, // BASE - 1
  CONTINUATION_BIT: 1 << 5, // BASE
} as const;

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_DECODE_MAP: ReadonlyMap<string, number> = new Map(
  Array.from(BASE64_ALPHABET).map((char, index) => [char, index]),
);

// ── VLQ decoding ──

function fromVlqSigned(value: number): number {
  // Arithmetic (not bitwise) so 32-bit boundary values survive: `>> 1` would overflow
  // past 2^31 and corrupt legal tc39 boundary mappings into negatives.
  const isNegative = value % 2 === 1;
  const shifted = (value - (isNegative ? 1 : 0)) / 2;
  return isNegative ? -shifted : shifted;
}

export function decodeVlqSegment(segment: string): number[] {
  const values: number[] = [];
  let index = 0;
  while (index < segment.length) {
    let result = 0;
    let shift = 0;
    let continuation = true;
    while (continuation) {
      const char = segment.charAt(index);
      if (!char) throw new Error(`Unexpected end of VLQ segment: "${segment}"`);
      index += 1;
      const digit = BASE64_DECODE_MAP.get(char);
      if (digit === undefined)
        throw new Error(`Invalid VLQ base64 char "${char}" in segment "${segment}"`);
      continuation = (digit & VlqConstant.CONTINUATION_BIT) !== 0;
      const digitValue = digit & VlqConstant.BASE_MASK;
      // Accumulate with multiplication: `<<` silently overflows past shift 30, but the
      // spec allows 32-bit boundary values (tc39 valid-mapping-boundary-values).
      result += digitValue * 2 ** shift;
      shift += VlqConstant.BASE_SHIFT;
    }
    values.push(fromVlqSigned(result));
  }
  return values;
}

export function decodeVlqSegmentUnsigned(segment: string): number[] {
  const values: number[] = [];
  let index = 0;
  while (index < segment.length) {
    let result = 0;
    let shift = 0;
    let continuation = true;
    while (continuation) {
      const char = segment.charAt(index);
      if (!char) throw new Error(`Unexpected end of VLQ segment: "${segment}"`);
      index += 1;
      const digit = BASE64_DECODE_MAP.get(char);
      if (digit === undefined)
        throw new Error(`Invalid VLQ base64 char "${char}" in segment "${segment}"`);
      continuation = (digit & VlqConstant.CONTINUATION_BIT) !== 0;
      const digitValue = digit & VlqConstant.BASE_MASK;
      result += digitValue << shift;
      shift += VlqConstant.BASE_SHIFT;
    }
    values.push(result);
  }
  return values;
}

/**
 * ECMA-426 conformance (tc39/source-map-tests) validation for one decoded segment:
 * absolute positions must never go negative, segment field count must be 1/4/5, and
 * the running deltas are folded into `state`.
 */
function buildValidatedMapping(
  segment: string,
  lineIndex: number,
  generatedColumn: number,
  values: number[],
  state: { source: number; originalLine: number; originalColumn: number; name: number },
): DecodedMapping {
  const where = (reason: string): Error =>
    new Error(
      `invalid mappings segment "${segment}" on generated line ${lineIndex + 1}: ${reason}`,
    );
  if (generatedColumn < 0) throw where(`generated column ${generatedColumn} is negative`);
  if (values.length === 2 || values.length === 3) {
    throw where(`${values.length} fields (must be 1, 4, or 5)`);
  }
  const mapping: DecodedMapping = { generatedLine: lineIndex + 1, generatedColumn };
  if (values.length >= 4) {
    state.source += values[1] ?? 0;
    state.originalLine += values[2] ?? 0;
    state.originalColumn += values[3] ?? 0;
    if (state.source < 0 || state.originalLine < 0 || state.originalColumn < 0) {
      throw where('negative source/line/column after delta decoding');
    }
    mapping.sourceIndex = state.source;
    mapping.originalLine = state.originalLine + 1;
    mapping.originalColumn = state.originalColumn;
    if (values.length >= 5) {
      state.name += values[4] ?? 0;
      if (state.name < 0) throw where(`name index ${state.name} is negative`);
      mapping.nameIndex = state.name;
    }
  }
  return mapping;
}

export function decodeMappings(mappings: string): DecodedMapping[] {
  if (!mappings) return [];
  const decoded: DecodedMapping[] = [];
  const running = { source: 0, originalLine: 0, originalColumn: 0, name: 0 };
  const lines = mappings.split(';');
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? '';
    let generatedColumn = 0;
    if (!line) continue;
    const segments = line.split(',');
    for (const segment of segments) {
      if (!segment) continue;
      const values = decodeVlqSegment(segment);
      const generatedDelta = values[0];
      if (generatedDelta === undefined) continue;
      generatedColumn += generatedDelta;
      decoded.push(buildValidatedMapping(segment, lineIndex, generatedColumn, values, running));
    }
  }
  return decoded;
}

export function countMappingsStats(mappings: string): {
  mappingsCount: number;
  segmentCount: number;
} {
  if (!mappings) return { mappingsCount: 0, segmentCount: 0 };
  let mappingsCount = 0;
  let segmentCount = 0;
  let inNonEmptyLine = false;
  for (let i = 0; i < mappings.length; i++) {
    const ch = mappings[i];
    if (ch === ';') {
      if (inNonEmptyLine) mappingsCount++;
      inNonEmptyLine = false;
    } else if (ch === ',') {
      segmentCount++;
    } else {
      if (!inNonEmptyLine) {
        inNonEmptyLine = true;
        segmentCount++;
      }
    }
  }
  if (inNonEmptyLine) mappingsCount++;
  return { mappingsCount, segmentCount };
}

// ── Response helpers ──

export function json(payload: unknown): TextToolResponse {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

export function fail(tool: string, error: unknown): TextToolResponse {
  const message = error instanceof Error ? error.message : String(error);
  return json({ success: false, tool, error: message });
}

// ── Type helpers ──

export function asRecord(value: unknown): JsonRecord {
  return typeof value === 'object' && value !== null ? (value as JsonRecord) : {};
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function hasProtocol(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
}

export function parseBooleanArg(value: unknown, defaultValue: boolean): boolean {
  return typeof value === 'boolean' ? value : defaultValue;
}

export function requiredStringArg(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new Error(`${fieldName} is required`);
  return value.trim();
}

export function optionalStringArg(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function safeDetach(session: CdpSessionLike): Promise<void> {
  if (!session.detach) return;
  try {
    await session.detach();
  } catch {
    /* ignore */
  }
}

export async function trySend(
  session: CdpSessionLike,
  method: string,
  params?: JsonRecord,
): Promise<void> {
  try {
    await session.send(method, params);
  } catch {
    /* ignore */
  }
}

export async function delay(ms: number): Promise<void> {
  await new Promise<void>((r) => setTimeout(() => r(), ms));
}
