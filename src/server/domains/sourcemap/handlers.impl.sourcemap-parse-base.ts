import type { CodeCollector } from '../../../modules/collector/CodeCollector.js';

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

const VLQ_BASE_SHIFT = 5;
const VLQ_BASE = 1 << VLQ_BASE_SHIFT;
const VLQ_BASE_MASK = VLQ_BASE - 1;
const VLQ_CONTINUATION_BIT = VLQ_BASE;

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const BASE64_DECODE_MAP: ReadonlyMap<string, number> = new Map(
  Array.from(BASE64_ALPHABET).map((char, index) => [char, index])
);



export class SourcemapToolHandlersParseBase {
  protected collector: CodeCollector;

  constructor(collector: CodeCollector) {
    this.collector = collector;
  }

  protected async parseSourceMap(
    sourceMapUrl: string,
    scriptUrl?: string
  ): Promise<ParsedSourceMapResult> {
    const loaded = await this.loadSourceMap(sourceMapUrl, scriptUrl);
    const mappings = this.decodeMappings(loaded.map.mappings);
    const generatedLines = new Set<number>(mappings.map((item) => item.generatedLine));

    return {
      resolvedUrl: loaded.resolvedUrl,
      map: loaded.map,
      mappings,
      mappingsCount: generatedLines.size,
      segmentCount: mappings.length,
    };
  }

  protected async loadSourceMap(
    sourceMapUrl: string,
    scriptUrl?: string
  ): Promise<{ resolvedUrl: string; map: SourceMapV3 }> {
    const resolvedUrl = this.resolveSourceMapUrl(sourceMapUrl, scriptUrl ?? '');

    let sourceMapText = '';
    if (resolvedUrl.startsWith('data:')) {
      sourceMapText = this.decodeDataUriJson(resolvedUrl);
    } else {
      sourceMapText = await this.fetchSourceMapText(resolvedUrl);
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(sourceMapText);
    } catch {
      throw new Error(`Invalid SourceMap JSON: ${resolvedUrl}`);
    }

    const map = this.normalizeSourceMap(parsedJson);
    return { resolvedUrl, map };
  }

  protected normalizeSourceMap(value: unknown): SourceMapV3 {
    const record = this.asRecord(value);
    const versionRaw = record.version;
    if (versionRaw !== 3) {
      throw new Error('Only SourceMap version 3 is supported');
    }

    const mappings = this.asString(record.mappings);
    if (mappings === undefined) {
      throw new Error('SourceMap.mappings is required');
    }

    const rawSources = Array.isArray(record.sources) ? record.sources : [];
    const sources = rawSources
      .map((item) => this.asString(item))
      .filter((item): item is string => typeof item === 'string');

    const rawNames = Array.isArray(record.names) ? record.names : [];
    const names = rawNames
      .map((item) => this.asString(item))
      .filter((item): item is string => typeof item === 'string');

    const sourceRoot = this.asString(record.sourceRoot);

    let sourcesContent: Array<string | null> | undefined;
    if (Array.isArray(record.sourcesContent)) {
      sourcesContent = record.sourcesContent.map((item) => {
        if (typeof item === 'string') {
          return item;
        }
        if (item === null) {
          return null;
        }
        return null;
      });
    }

    return {
      version: 3,
      sources,
      sourcesContent,
      mappings,
      names,
      sourceRoot,
    };
  }

  protected decodeMappings(mappings: string): DecodedMapping[] {
    if (!mappings) {
      return [];
    }

    const decoded: DecodedMapping[] = [];

    let previousSource = 0;
    let previousOriginalLine = 0;
    let previousOriginalColumn = 0;
    let previousName = 0;

    const lines = mappings.split(';');
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex] ?? '';
      let generatedColumn = 0;

      if (!line) {
        continue;
      }

      const segments = line.split(',');
      for (const segment of segments) {
        if (!segment) {
          continue;
        }

        const values = this.decodeVlqSegment(segment);
        const generatedDelta = values[0];
        if (generatedDelta === undefined) {
          continue;
        }

        generatedColumn += generatedDelta;

        const mapping: DecodedMapping = {
          generatedLine: lineIndex + 1,
          generatedColumn,
        };

        if (values.length >= 4) {
          previousSource += values[1] ?? 0;
          previousOriginalLine += values[2] ?? 0;
          previousOriginalColumn += values[3] ?? 0;

          mapping.sourceIndex = previousSource;
          mapping.originalLine = previousOriginalLine + 1;
          mapping.originalColumn = previousOriginalColumn;

          if (values.length >= 5) {
            previousName += values[4] ?? 0;
            mapping.nameIndex = previousName;
          }
        }

        decoded.push(mapping);
      }
    }

    return decoded;
  }

  protected decodeVlqSegment(segment: string): number[] {
    const values: number[] = [];
    let index = 0;

    while (index < segment.length) {
      let result = 0;
      let shift = 0;
      let continuation = true;

      while (continuation) {
        const char = segment.charAt(index);
        if (!char) {
          throw new Error(`Unexpected end of VLQ segment: "${segment}"`);
        }

        index += 1;
        const digit = BASE64_DECODE_MAP.get(char);
        if (digit === undefined) {
          throw new Error(`Invalid VLQ base64 char "${char}" in segment "${segment}"`);
        }

        continuation = (digit & VLQ_CONTINUATION_BIT) !== 0;
        const digitValue = digit & VLQ_BASE_MASK;
        result += digitValue << shift;
        shift += VLQ_BASE_SHIFT;
      }

      values.push(this.fromVlqSigned(result));
    }

    return values;
  }

  protected fromVlqSigned(value: number): number {
    const isNegative = (value & 1) === 1;
    const shifted = value >> 1;
    return isNegative ? -shifted : shifted;
  }

  protected async fetchSourceMapText(resolvedUrl: string): Promise<string> {
    // SSRF guard: block protected/reserved network addresses on server-side fetch
    this.validateFetchUrl(resolvedUrl);

    try {
      const response = await fetch(resolvedUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      return await response.text();
    } catch {
      // Fallback: fetch from page context (same-origin, has cookies)
      const page = await this.collector.getActivePage();
      const fetched = await page.evaluate(async (url) => {
        try {
          const resp = await fetch(url);
          if (!resp.ok) {
            return `__FETCH_ERROR__HTTP ${resp.status} ${resp.statusText}`;
          }
          return await resp.text();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return `__FETCH_ERROR__${message}`;
        }
      }, resolvedUrl);

      if (typeof fetched !== 'string') {
        throw new Error('Failed to fetch SourceMap content');
      }

      if (fetched.startsWith('__FETCH_ERROR__')) {
        const message = fetched.slice('__FETCH_ERROR__'.length);
        throw new Error(message || 'Failed to fetch SourceMap content');
      }

      return fetched;
    }
  }

  protected validateFetchUrl(url: string): void {
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

    // Block protected/reserved IP ranges
    const blockedPatterns = [
      /^127\./,                        // loopback IPv4
      /^10\./,                         // 10.0.0.0/8
      /^172\.(1[6-9]|2\d|3[01])\./,  // 172.16.0.0/12
      /^192\.168\./,                   // 192.168.0.0/16
      /^0\./,                          // 0.0.0.0/8
      /^169\.254\./,                   // link-local
      /^\[?::1\]?$/,                   // IPv6 loopback
      /^\[?fe80:/i,                    // IPv6 link-local
      /^\[?fc00:/i,                    // IPv6 unique local
      /^\[?fd/i,                       // IPv6 unique local
    ];

    const blockedHostnames = ['localhost', 'metadata.google.internal', 'metadata'];

    if (blockedHostnames.includes(hostname)) {
      throw new Error(`SSRF blocked: hostname "${hostname}" is not allowed`);
    }

    for (const pattern of blockedPatterns) {
      if (pattern.test(hostname)) {
        throw new Error(`SSRF blocked: protected/reserved IP "${hostname}" is not allowed`);
      }
    }
  }

  protected decodeDataUriJson(dataUri: string): string {
    const commaIndex = dataUri.indexOf(',');
    if (commaIndex === -1) {
      throw new Error('Invalid data URI source map');
    }

    const metadata = dataUri.slice(0, commaIndex);
    const dataPart = dataUri.slice(commaIndex + 1);

    if (/;base64/i.test(metadata)) {
      return Buffer.from(dataPart, 'base64').toString('utf-8');
    }

    return decodeURIComponent(dataPart);
  }

  protected resolveSourceMapUrl(sourceMapUrl: string, scriptUrl: string): string {
    const trimmed = sourceMapUrl.trim();
    if (!trimmed) {
      return '';
    }

    if (trimmed.startsWith('data:')) {
      return trimmed;
    }

    if (this.hasProtocol(trimmed)) {
      return trimmed;
    }

    if (!scriptUrl) {
      return trimmed;
    }

    try {
      return new URL(trimmed, scriptUrl).toString();
    } catch {
      return trimmed;
    }
  }

  protected extractSourceMappingUrlFromScript(scriptSource: string): string | null {
    const tail = scriptSource.slice(-8192);
    const regex =
      /(?:\/\/[@#]\s*sourceMappingURL=([^\s]+)|\/\*[@#]\s*sourceMappingURL=([^*]+)\*\/)/g;

    let match: RegExpExecArray | null;
    let found: string | null = null;

    while (true) {
      match = regex.exec(tail);
      if (!match) {
        break;
      }
      const candidate = (match[1] ?? match[2] ?? '').trim();
      if (candidate) {
        found = candidate;
      }
    }

    return found;
  }

  protected hasProtocol(value: string): boolean {
    return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
  }

  protected asRecord(value: unknown): JsonRecord {
    return typeof value === 'object' && value !== null ? (value as JsonRecord) : {};
  }

  protected asString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }
}
