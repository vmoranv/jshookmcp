/**
 * Sourcemap parsing, URL resolution, and path normalization functions.
 */

import { evaluateWithTimeout } from '@modules/collector/PageController';
import type { CodeCollector } from '@server/domains/shared/modules';
import type { SourceMapV3, ParsedSourceMapResult } from './shared';
import { decodeMappings, countMappingsStats, hasProtocol, asRecord, asString } from './shared';

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

async function fetchSourceMapText(resolvedUrl: string, collector: CodeCollector): Promise<string> {
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
  const blockedPatterns = [
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^0\./,
    /^169\.254\./,
    /^\[?::1\]?$/,
    /^\[?fe80:/i,
    /^\[?fc00:/i,
    /^\[?fd/i,
  ];
  const blockedHostnames = ['localhost', 'metadata.google.internal', 'metadata'];
  if (blockedHostnames.includes(hostname))
    throw new Error(`SSRF blocked: hostname "${hostname}" is not allowed`);
  for (const pattern of blockedPatterns) {
    if (pattern.test(hostname))
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
