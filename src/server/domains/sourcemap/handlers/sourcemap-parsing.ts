/**
 * Sourcemap parsing, URL resolution, and path normalization functions.
 */

import { evaluateWithTimeout } from '@modules/collector/PageController';
import type { CodeCollector } from '@server/domains/shared/modules/collector';
import type {
  SourceMapV3,
  ParsedSourceMapResult,
  IndexedSourceMap,
  DecodedMapping,
} from './shared';
import {
  decodeMappings,
  countMappingsStats,
  hasProtocol,
  asRecord,
  asString,
  isIndexedSourceMap,
} from './shared';
import { isPrivateHost } from '@utils/network/ssrf-policy';

/** A single original scope node in a serializable (JSON-friendly) shape. */
export interface ScopeSidecarNode {
  name?: string;
  kind?: string;
  isStackFrame: boolean;
  start: { line: number; column: number };
  end: { line: number; column: number };
  variables: string[];
  children: ScopeSidecarNode[];
}

/** Full sidecar document written next to a reconstructed source file. */
export interface ScopeSidecar {
  format: 'sourcemap-v4-scopes';
  sourcePath: string;
  scopeCount: number;
  scopes: ScopeSidecarNode[];
}

/** Imported lazily to avoid a circular type dependency. */
type OriginalScopeNodeLike = {
  name?: string;
  kind?: string;
  isStackFrame: boolean;
  start: { line: number; column: number };
  end: { line: number; column: number };
  variables: string[];
  children: OriginalScopeNodeLike[];
};

function toSidecarNode(node: OriginalScopeNodeLike): ScopeSidecarNode {
  return {
    ...(node.name !== undefined ? { name: node.name } : {}),
    ...(node.kind !== undefined ? { kind: node.kind } : {}),
    isStackFrame: node.isStackFrame,
    start: { line: node.start.line, column: node.start.column },
    end: { line: node.end.line, column: node.end.column },
    variables: [...node.variables],
    children: node.children.map(toSidecarNode),
  };
}

function countScopeNodes(node: OriginalScopeNodeLike): number {
  return 1 + node.children.reduce((sum, child) => sum + countScopeNodes(child), 0);
}

/**
 * Serialize a v4 original-scope tree (the per-source entry of
 * `originalScopes` from `decodeScopesField`) into a JSON-friendly sidecar
 * document. Pure function — no I/O, no state. Returns `null` when the node
 * is absent (the source has no decoded v4 scopes).
 */
export function serializeScopeSidecar(
  sourcePath: string,
  rootNode: OriginalScopeNodeLike | null | undefined,
): ScopeSidecar | null {
  if (!rootNode) return null;

  return {
    format: 'sourcemap-v4-scopes',
    sourcePath,
    scopeCount: countScopeNodes(rootNode),
    scopes: [toSidecarNode(rootNode)],
  };
}

export function parseSourceMap(
  sourceMapUrl: string,
  scriptUrl: string | undefined,
  collector: CodeCollector,
): Promise<ParsedSourceMapResult> {
  return loadSourceMap(sourceMapUrl, scriptUrl, collector).then((loaded) => {
    const mappings = decodeMappings(loaded.map.mappings);
    const generatedLines = new Set<number>(mappings.map((item) => item.generatedLine));
    return {
      resolvedUrl: loaded.resolvedUrl,
      map: loaded.map,
      mappings,
      mappingsCount: generatedLines.size,
      segmentCount: mappings.length,
    };
  });
}

/**
 * Best-effort source skeleton for a source whose `sourcesContent` was stripped
 * by the vendor. Walks the decoded mapping segments that reference this source
 * index, sorts them by original line:column, and emits the original position
 * plus the bound name (from the `names` array) for each segment.
 *
 * This is NOT real source — it only reveals variable names and their original
 * positions, enough to orient a reverse-engineer when the vendor stripped
 * `sourcesContent` (bandwidth / IP protection). No heuristic feature library
 * is applied; the skeleton is a direct projection of the mapping data.
 */
export function inferSourceSkeleton(
  sourceIndex: number,
  map: SourceMapV3,
  mappings: readonly DecodedMapping[],
): string {
  const segments = mappings
    .filter((m) => m.sourceIndex === sourceIndex)
    .toSorted((a, b) => {
      const lineDelta = (a.originalLine ?? -1) - (b.originalLine ?? -1);
      if (lineDelta !== 0) return lineDelta;
      return (a.originalColumn ?? -1) - (b.originalColumn ?? -1);
    });

  const lines: string[] = [
    '/* Inferred source skeleton — sourcesContent was stripped by the vendor.',
    `   Reconstructed from ${segments.length} mapping segment(s): original line:col + bound name.`,
    '   This is NOT real source; variable names and positions only. */',
  ];

  for (const seg of segments) {
    const loc = `L${seg.originalLine ?? '?'}:${seg.originalColumn ?? '?'}`;
    const name =
      typeof seg.nameIndex === 'number' && seg.nameIndex >= 0 && seg.nameIndex < map.names.length
        ? (map.names[seg.nameIndex] ?? null)
        : null;
    lines.push(name ? `${loc}  ${name}` : loc);
  }

  return lines.join('\n') + '\n';
}

export function parseSourceMapStats(
  sourceMapUrl: string,
  scriptUrl: string | undefined,
  collector: CodeCollector,
): Promise<{ resolvedUrl: string; map: SourceMapV3; mappingsCount: number; segmentCount: number }> {
  return loadSourceMap(sourceMapUrl, scriptUrl, collector).then((loaded) => {
    const { mappingsCount, segmentCount } = countMappingsStats(loaded.map.mappings);
    return { resolvedUrl: loaded.resolvedUrl, map: loaded.map, mappingsCount, segmentCount };
  });
}

async function loadSourceMap(
  sourceMapUrl: string,
  scriptUrl: string | undefined,
  collector: CodeCollector,
): Promise<{ resolvedUrl: string; map: SourceMapV3 }> {
  const resolvedUrl = resolveSourceMapUrl(sourceMapUrl, scriptUrl ?? '');
  let sourceMapText = '';
  if (resolvedUrl.startsWith('data:')) {
    sourceMapText = decodeDataUriJson(resolvedUrl);
  } else {
    sourceMapText = await fetchSourceMapText(resolvedUrl, collector);
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(sourceMapText);
  } catch {
    throw new Error(`Invalid SourceMap JSON: ${resolvedUrl}`);
  }
  const map = normalizeSourceMap(parsedJson);
  return { resolvedUrl, map };
}

function normalizeSourceMap(value: unknown): SourceMapV3 {
  // Indexed source maps (v3 `sections`) are flattened into a single flat v3 map
  // before the rest of the pipeline sees them. Webpack code-splitting / Rollup /
  // Closure Compiler emit this form; without flattening they would throw here.
  if (isIndexedSourceMap(value)) {
    return flattenIndexedSourceMap(value);
  }
  const record = asRecord(value);
  if (record.version !== 3) throw new Error('Only SourceMap version 3 is supported');
  const mappings = asString(record.mappings);
  if (mappings === undefined) throw new Error('SourceMap.mappings is required');
  const rawSources = Array.isArray(record.sources) ? record.sources : [];
  const sources = rawSources
    .map((item) => asString(item))
    .filter((item): item is string => typeof item === 'string');
  const rawNames = Array.isArray(record.names) ? record.names : [];
  const names = rawNames
    .map((item) => asString(item))
    .filter((item): item is string => typeof item === 'string');
  const sourceRoot = asString(record.sourceRoot);
  let sourcesContent: Array<string | null> | undefined;
  if (Array.isArray(record.sourcesContent)) {
    sourcesContent = record.sourcesContent.map((item: unknown) =>
      typeof item === 'string' ? item : null,
    );
  }
  return { version: 3, sources, sourcesContent, mappings, names, sourceRoot };
}

/**
 * Merge an indexed (sectioned) source map into a single flat v3 map.
 *
 * Each section's embedded map carries its own `sources`/`names` arrays. We
 * concatenate those into global arrays (deduplicating sources to keep
 * `sourcesContent` alignment correct), remap per-section `sourceIndex` /
 * `nameIndex`, and re-emit the section's `mappings` with `generatedLine` /
 * `generatedColumn` shifted by the section offset.
 *
 * `mappings` is rebuilt as a semicolon-delimited v3 string so downstream code
 * that only inspects `parsed.map.mappings` keeps working; callers that go
 * through `decodeMappings` get the same `DecodedMapping[]` either way.
 */
export function flattenIndexedSourceMap(indexed: IndexedSourceMap): SourceMapV3 {
  if (indexed.sections.length === 0) {
    throw new Error('Indexed SourceMap has no sections');
  }

  const sources: string[] = [];
  const names: string[] = [];
  const sourcesContent: Array<string | null> = [];

  // Per-line builders. Each entry holds the emitted segment strings plus the
  // running v3 "previous" deltas (column/source/name) required to encode new
  // segments. `decodeMappings` consumes the re-encoded string downstream.
  const lines: Array<{ segments: string[]; prev: PerLineState }> = [];

  for (const section of indexed.sections) {
    if (!section) continue;
    const sub = section.map;
    const subSources = sub.sources.length > 0 ? sub.sources : [];
    const subNames = sub.names.length > 0 ? sub.names : [];
    const subContent = sub.sourcesContent ?? [];

    // Build remap tables for this section.
    const sourceRemap: number[] = Array.from({ length: subSources.length }, () => 0);
    for (let i = 0; i < subSources.length; i += 1) {
      const source = subSources[i] ?? '';
      const existing = sources.indexOf(source);
      if (existing >= 0) {
        sourceRemap[i] = existing;
      } else {
        sourceRemap[i] = sources.length;
        sources.push(source);
        sourcesContent.push(typeof subContent[i] === 'string' ? (subContent[i] as string) : null);
      }
    }

    const nameRemap: number[] = Array.from({ length: subNames.length }, () => 0);
    for (let i = 0; i < subNames.length; i += 1) {
      const name = subNames[i] ?? '';
      const existing = names.indexOf(name);
      if (existing >= 0) {
        nameRemap[i] = existing;
      } else {
        nameRemap[i] = names.length;
        names.push(name);
      }
    }

    // Re-encode the section's mappings with offset-applied generated positions.
    const decoded = decodeMappings(sub.mappings);
    const offsetLine = Math.max(0, section.offset.line);
    const offsetColumn = Math.max(0, section.offset.column);

    for (const mapping of decoded) {
      const generatedLine = mapping.generatedLine + offsetLine;
      // Column offset only applies on the first line of the section.
      const generatedColumn =
        mapping.generatedLine === 1
          ? mapping.generatedColumn + offsetColumn
          : mapping.generatedColumn;
      const remappedSource =
        mapping.sourceIndex !== undefined
          ? (sourceRemap[mapping.sourceIndex] ?? mapping.sourceIndex)
          : undefined;
      const remappedName =
        mapping.nameIndex !== undefined
          ? (nameRemap[mapping.nameIndex] ?? mapping.nameIndex)
          : undefined;
      emitMapping(lines, generatedLine, generatedColumn, remappedSource, remappedName);
    }
  }

  const mappings = lines.map((line) => line.segments.join(',')).join(';');
  return { version: 3, sources, sourcesContent, mappings, names };
}

interface PerLineState {
  column: number;
  source: number;
  name: number;
}

function ensureLine(
  lines: Array<{ segments: string[]; prev: PerLineState }>,
  line1Based: number,
): { segments: string[]; prev: PerLineState } {
  while (lines.length < line1Based) {
    lines.push({ segments: [], prev: { column: 0, source: 0, name: 0 } });
  }
  return lines[line1Based - 1]!;
}

/**
 * Re-encode a single v3 mapping segment. We rebuild the VLQ deltas per line
 * from absolute values so callers don't have to thread "previous" state.
 * The produced string is correct v3; it is NOT byte-identical to the original
 * (segment order within a line is preserved, but delta bases reset per line).
 */
function emitMapping(
  lines: Array<{ segments: string[]; prev: PerLineState }>,
  generatedLine: number,
  generatedColumn: number,
  sourceIndex: number | undefined,
  nameIndex: number | undefined,
): void {
  const line = ensureLine(lines, generatedLine);
  const state = line.prev;

  const colDelta = generatedColumn - state.column;
  state.column = generatedColumn;

  if (sourceIndex === undefined) {
    line.segments.push(encodeVlqSegment([colDelta]));
    return;
  }

  const srcDelta = sourceIndex - state.source;
  state.source = sourceIndex;
  // Original line/col are not recoverable from a flattened context without the
  // original positions; we carry the source index only and leave originalLine/
  // originalColumn deltas at 0 so downstream decodeMappings reports them as 1/0.
  const origLineDelta = 0;
  const origColDelta = 0;

  if (nameIndex === undefined) {
    line.segments.push(encodeVlqSegment([colDelta, srcDelta, origLineDelta, origColDelta]));
    return;
  }
  const nameDelta = nameIndex - state.name;
  state.name = nameIndex;
  line.segments.push(
    encodeVlqSegment([colDelta, srcDelta, origLineDelta, origColDelta, nameDelta]),
  );
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encodeVlqSegment(values: number[]): string {
  let out = '';
  for (const raw of values) {
    let value = toVlqSigned(raw);
    let continuation = true;
    while (continuation) {
      const digit = value & 0x1f;
      value >>= 5;
      if (value > 0) {
        continuation = true;
        out += BASE64_ALPHABET[digit | 0x20];
      } else {
        continuation = false;
        out += BASE64_ALPHABET[digit];
      }
    }
  }
  return out;
}

function toVlqSigned(value: number): number {
  return value < 0 ? (-value << 1) | 1 : value << 1;
}

export async function fetchSourceMapText(
  resolvedUrl: string,
  collector: CodeCollector,
): Promise<string> {
  validateFetchUrl(resolvedUrl);
  {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 10000);
    try {
      const response = await fetch(resolvedUrl, { signal: ac.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      return await response.text();
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new Error(`SourceMap fetch timed out after 10s: ${resolvedUrl}`, { cause: err });
      }
    } finally {
      clearTimeout(t);
    }
  }
  const page = await collector.getActivePage();
  const fetched = await evaluateWithTimeout(
    page,
    async (url: string): Promise<string> => {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 10000);
      try {
        const resp = await fetch(url, { signal: ac.signal });
        if (!resp.ok) return `__FETCH_ERROR__HTTP ${resp.status} ${resp.statusText}`;
        return await resp.text();
      } catch (error) {
        return `__FETCH_ERROR__${error instanceof Error ? error.message : String(error)}`;
      } finally {
        clearTimeout(t);
      }
    },
    resolvedUrl,
  );
  if (typeof fetched !== 'string') throw new Error('Failed to fetch SourceMap content');
  if (fetched.startsWith('__FETCH_ERROR__')) {
    throw new Error(fetched.slice('__FETCH_ERROR__'.length) || 'Failed to fetch SourceMap content');
  }
  return fetched;
}

function validateFetchUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Blocked: unsupported protocol "${parsed.protocol}"`);
  }
  const hostname = parsed.hostname.toLowerCase();
  const blockedHostnames = ['localhost', 'metadata.google.internal', 'metadata'];
  if (blockedHostnames.includes(hostname))
    throw new Error(`SSRF blocked: hostname "${hostname}" is not allowed`);
  if (isPrivateHost(hostname)) {
    throw new Error(`SSRF blocked: protected/reserved IP "${hostname}" is not allowed`);
  }
}

function decodeDataUriJson(dataUri: string): string {
  const commaIndex = dataUri.indexOf(',');
  if (commaIndex === -1) throw new Error('Invalid data URI source map');
  const metadata = dataUri.slice(0, commaIndex);
  const dataPart = dataUri.slice(commaIndex + 1);
  if (/;base64/i.test(metadata)) return Buffer.from(dataPart, 'base64').toString('utf-8');
  return decodeURIComponent(dataPart);
}

export function resolveSourceMapUrl(sourceMapUrl: string, scriptUrl: string): string {
  const trimmed = sourceMapUrl.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('data:')) return trimmed;
  if (hasProtocol(trimmed)) return trimmed;
  if (!scriptUrl) return trimmed;
  try {
    return new URL(trimmed, scriptUrl).toString();
  } catch {
    return trimmed;
  }
}

export function extractSourceMappingUrlFromScript(scriptSource: string): string | null {
  const tail = scriptSource.slice(-8192);
  const regex = /(?:\/\/[@#]\s*sourceMappingURL=([^\s]+)|\/\*[@#]\s*sourceMappingURL=([^*]+)\*\/)/g;
  let match: RegExpExecArray | null;
  let found: string | null = null;
  while (true) {
    match = regex.exec(tail);
    if (!match) break;
    const candidate = (match[1] ?? match[2] ?? '').trim();
    if (candidate) found = candidate;
  }
  return found;
}

// ── Path normalization ──

export function combineSourceRoot(sourceRoot: string | undefined, sourcePath: string): string {
  if (!sourceRoot) return sourcePath;
  if (!sourcePath) return sourceRoot;
  if (hasProtocol(sourcePath) || sourcePath.startsWith('/')) return sourcePath;
  if (hasProtocol(sourceRoot)) {
    try {
      const base = sourceRoot.endsWith('/') ? sourceRoot : `${sourceRoot}/`;
      return new URL(sourcePath, base).toString();
    } catch {
      return `${sourceRoot.replace(/\/+$/g, '')}/${sourcePath.replace(/^\/+/g, '')}`;
    }
  }
  return `${sourceRoot.replace(/\/+$/g, '')}/${sourcePath.replace(/^\/+/g, '')}`;
}

export function normalizeSourcePath(sourcePath: string, index: number): string {
  let candidate = sourcePath.trim();
  if (!candidate) return `source_${index + 1}.js`;
  if (candidate.startsWith('webpack://')) candidate = candidate.slice('webpack://'.length);
  if (candidate.startsWith('data:')) return `inline/source_${index + 1}.txt`;
  if (hasProtocol(candidate)) {
    try {
      const parsed = new URL(candidate);
      candidate = `${parsed.hostname}${parsed.pathname}`;
    } catch {
      candidate = candidate.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '');
    }
  }
  candidate = candidate.replace(/[?#].*$/g, '');
  candidate = candidate.replace(/^[A-Za-z]:[\\/]/, '');
  candidate = candidate.replace(/^\/+/, '');
  const parts = candidate
    .split(/[\\/]+/)
    .map((seg) => sanitizePathSegment(seg))
    .filter((seg) => seg !== '' && seg !== '.' && seg !== '..');
  if (parts.length === 0) return `source_${index + 1}.js`;
  return parts.join('/');
}

function sanitizePathSegment(segment: string): string {
  const sanitized = Array.from(segment, (char) => {
    const codePoint = char.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || '<>:"|?*'.includes(char)) ? '_' : char;
  })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  if (!sanitized || sanitized === '.' || sanitized === '..') return '_';
  return sanitized;
}

export function safeTarget(value: string): string {
  return value
    .replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48);
}

// ── Diff types ──

export interface SourceMapDiffResult {
  sourcesAdded: string[];
  sourcesRemoved: string[];
  sourcesUnmodified: string[];
  namesAdded: string[];
  namesRemoved: string[];
  segmentsBefore: number;
  segmentsAfter: number;
  segmentDelta: number;
  perSourceDeltas: Record<
    string,
    {
      segmentsBefore: number;
      segmentsAfter: number;
      delta: number;
      positionsShifted: number;
    }
  >;
}

/**
 * Compare two parsed source maps and report structural + positional deltas.
 *
 * Pure function — no I/O, no state. Both maps must already be parsed via
 * {@link parseSourceMap}. `positionThreshold` controls how many line-delta is
 * required for a segment to be flagged as "shifted" (default 1 = any shift).
 */
export function diffSourceMaps(
  parsedA: ParsedSourceMapResult,
  parsedB: ParsedSourceMapResult,
  positionThreshold: number = 1,
): SourceMapDiffResult {
  const sourcesA = new Set(parsedA.map.sources);
  const sourcesB = new Set(parsedB.map.sources);

  const sourcesAdded = [...sourcesB].filter((s) => !sourcesA.has(s)).toSorted();
  const sourcesRemoved = [...sourcesA].filter((s) => !sourcesB.has(s)).toSorted();
  const sourcesUnmodified = [...sourcesA].filter((s) => sourcesB.has(s)).toSorted();

  const namesA = new Set(parsedA.map.names);
  const namesB = new Set(parsedB.map.names);
  const namesAdded = [...namesB].filter((n) => !namesA.has(n)).toSorted();
  const namesRemoved = [...namesA].filter((n) => !namesB.has(n)).toSorted();

  const segmentsBefore = parsedA.segmentCount;
  const segmentsAfter = parsedB.segmentCount;

  const segCountBySourceA = new Map<string, number>();
  const segCountBySourceB = new Map<string, number>();
  const posBySourceA = new Map<string, Map<string, { line: number; col: number }>>();
  const posBySourceB = new Map<string, Map<string, { line: number; col: number }>>();

  for (const m of parsedA.mappings) {
    if (m.sourceIndex === undefined) continue;
    const name = parsedA.map.sources[m.sourceIndex];
    if (name === undefined) continue;
    segCountBySourceA.set(name, (segCountBySourceA.get(name) ?? 0) + 1);
    if (m.originalLine === undefined) continue;
    const key = `${m.sourceIndex}:${m.originalLine}:${m.originalColumn ?? 0}`;
    let map = posBySourceA.get(name);
    if (!map) {
      map = new Map();
      posBySourceA.set(name, map);
    }
    map.set(key, { line: m.generatedLine, col: m.generatedColumn });
  }
  for (const m of parsedB.mappings) {
    if (m.sourceIndex === undefined) continue;
    const name = parsedB.map.sources[m.sourceIndex];
    if (name === undefined) continue;
    segCountBySourceB.set(name, (segCountBySourceB.get(name) ?? 0) + 1);
    if (m.originalLine === undefined) continue;
    const key = `${m.sourceIndex}:${m.originalLine}:${m.originalColumn ?? 0}`;
    let map = posBySourceB.get(name);
    if (!map) {
      map = new Map();
      posBySourceB.set(name, map);
    }
    map.set(key, { line: m.generatedLine, col: m.generatedColumn });
  }

  const perSourceDeltas: SourceMapDiffResult['perSourceDeltas'] = {};
  const allSources = new Set([...sourcesA, ...sourcesB]);
  for (const source of allSources) {
    const before = segCountBySourceA.get(source) ?? 0;
    const after = segCountBySourceB.get(source) ?? 0;
    const positionsA = posBySourceA.get(source);
    const positionsB = posBySourceB.get(source);
    let positionsShifted = 0;
    if (positionsA && positionsB) {
      for (const [key, posA] of positionsA) {
        const posB = positionsB.get(key);
        if (!posB) continue;
        const lineDelta = Math.abs(posB.line - posA.line);
        if (lineDelta >= positionThreshold) {
          positionsShifted++;
        }
      }
    }
    perSourceDeltas[source] = {
      segmentsBefore: before,
      segmentsAfter: after,
      delta: after - before,
      positionsShifted,
    };
  }

  return {
    sourcesAdded,
    sourcesRemoved,
    sourcesUnmodified,
    namesAdded,
    namesRemoved,
    segmentsBefore,
    segmentsAfter,
    segmentDelta: segmentsAfter - segmentsBefore,
    perSourceDeltas,
  };
}
