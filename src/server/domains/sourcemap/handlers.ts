import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { CodeCollector } from '../../../modules/collector/CodeCollector.js';
import { resolveArtifactPath } from '../../../utils/artifacts.js';

type JsonRecord = Record<string, unknown>;

interface TextToolResponse {
  content: Array<{ type: 'text'; text: string }>;
}

interface CdpSessionLike {
  send(method: string, params?: JsonRecord): Promise<unknown>;
  on?(event: string, listener: (params: unknown) => void): void;
  off?(event: string, listener: (params: unknown) => void): void;
  detach?(): Promise<void>;
}

interface SourceMapV3 {
  version: 3;
  sources: string[];
  sourcesContent?: Array<string | null>;
  mappings: string;
  names: string[];
  sourceRoot?: string;
}

interface DecodedMapping {
  generatedLine: number;
  generatedColumn: number;
  sourceIndex?: number;
  originalLine?: number;
  originalColumn?: number;
  nameIndex?: number;
}

interface ParsedSourceMapResult {
  resolvedUrl: string;
  map: SourceMapV3;
  mappings: DecodedMapping[];
  mappingsCount: number;
  segmentCount: number;
}

interface DiscoverItem {
  scriptUrl: string;
  sourceMapUrl: string;
  isInline: boolean;
  scriptId: string;
}

interface MutableDiscoverItem extends DiscoverItem {}

interface ExtensionTarget {
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

export class SourcemapToolHandlers {
  private collector: CodeCollector;

  constructor(collector: CodeCollector) {
    this.collector = collector;
  }

  async handleSourcemapDiscover(
    args: Record<string, unknown>
  ): Promise<TextToolResponse> {
    const includeInline = this.parseBooleanArg(args.includeInline, true);

    const page = await this.collector.getActivePage();
    const session = (await page.createCDPSession()) as unknown as CdpSessionLike;
    const scripts = new Map<string, MutableDiscoverItem>();

    const onScriptParsed = (payload: unknown): void => {
      const record = this.asRecord(payload);
      const scriptId = this.asString(record.scriptId);
      if (!scriptId) {
        return;
      }

      const scriptUrl = this.asString(record.url) ?? '';
      const sourceMapUrlRaw = this.asString(record.sourceMapURL) ?? '';

      const existing = scripts.get(scriptId);
      const sourceMapUrlResolved = sourceMapUrlRaw
        ? this.resolveSourceMapUrl(sourceMapUrlRaw, scriptUrl)
        : existing?.sourceMapUrl ?? '';

      scripts.set(scriptId, {
        scriptId,
        scriptUrl: scriptUrl || existing?.scriptUrl || '',
        sourceMapUrl: sourceMapUrlResolved,
        isInline: sourceMapUrlResolved.startsWith('data:'),
      });
    };

    try {
      session.on?.('Debugger.scriptParsed', onScriptParsed);
      await session.send('Debugger.enable');
      await this.delay(250);

      for (const item of scripts.values()) {
        if (item.sourceMapUrl) {
          continue;
        }

        if (!item.scriptId || !item.scriptUrl) {
          continue;
        }

        try {
          const sourceResponse = this.asRecord(
            await session.send('Debugger.getScriptSource', {
              scriptId: item.scriptId,
            })
          );
          const scriptSource = this.asString(sourceResponse.scriptSource);
          if (!scriptSource) {
            continue;
          }

          const extracted = this.extractSourceMappingUrlFromScript(scriptSource);
          if (!extracted) {
            continue;
          }

          const resolvedSourceMap = this.resolveSourceMapUrl(
            extracted,
            item.scriptUrl
          );
          item.sourceMapUrl = resolvedSourceMap;
          item.isInline = resolvedSourceMap.startsWith('data:');
        } catch {
          continue;
        }
      }

      const result: DiscoverItem[] = Array.from(scripts.values())
        .filter((item) => item.sourceMapUrl.length > 0)
        .filter((item) => includeInline || !item.isInline)
        .sort((left, right) => {
          const leftKey = `${left.scriptUrl}|${left.scriptId}`;
          const rightKey = `${right.scriptUrl}|${right.scriptId}`;
          return leftKey.localeCompare(rightKey);
        })
        .map((item) => ({
          scriptUrl: item.scriptUrl,
          sourceMapUrl: item.sourceMapUrl,
          isInline: item.isInline,
          scriptId: item.scriptId,
        }));

      return this.json(result);
    } catch (error) {
      return this.fail('sourcemap_discover', error);
    } finally {
      session.off?.('Debugger.scriptParsed', onScriptParsed);
      await this.trySend(session, 'Debugger.disable');
      await this.safeDetach(session);
    }
  }

  async handleSourcemapFetchAndParse(
    args: Record<string, unknown>
  ): Promise<TextToolResponse> {
    try {
      const sourceMapUrl = this.requiredStringArg(args.sourceMapUrl, 'sourceMapUrl');
      const scriptUrl = this.optionalStringArg(args.scriptUrl);

      const parsed = await this.parseSourceMap(sourceMapUrl, scriptUrl);

      const responsePayload: JsonRecord = {
        sources: parsed.map.sources,
        mappingsCount: parsed.mappingsCount,
        segmentCount: parsed.segmentCount,
      };

      const hasSourcesContent = Array.isArray(parsed.map.sourcesContent);
      if (hasSourcesContent) {
        responsePayload.sourcesContent = parsed.map.sourcesContent as Array<string | null>;
      }

      return this.json(responsePayload);
    } catch (error) {
      return this.fail('sourcemap_fetch_and_parse', error);
    }
  }

  async handleSourcemapReconstructTree(
    args: Record<string, unknown>
  ): Promise<TextToolResponse> {
    try {
      const sourceMapUrl = this.requiredStringArg(args.sourceMapUrl, 'sourceMapUrl');
      const outputDir = this.optionalStringArg(args.outputDir);

      const parsed = await this.parseSourceMap(sourceMapUrl, undefined);

      const artifactTarget = this.safeTarget(parsed.resolvedUrl);
      const artifactPath = await resolveArtifactPath({
        category: 'reports',
        toolName: 'sourcemap-tree',
        target: artifactTarget,
        ext: 'tmp',
        ...(outputDir ? { customDir: outputDir } : {}),
      });

      const outputRoot = artifactPath.absolutePath.replace(/\.tmp$/i, '');
      const outputRootDisplay = artifactPath.displayPath.replace(/\.tmp$/i, '');
      await mkdir(outputRoot, { recursive: true });

      const writtenFiles: string[] = [];
      let skippedFiles = 0;

      for (let index = 0; index < parsed.map.sources.length; index += 1) {
        const rawSourcePath = parsed.map.sources[index] ?? '';
        const sourcePath = this.combineSourceRoot(parsed.map.sourceRoot, rawSourcePath);
        const relativePath = this.normalizeSourcePath(sourcePath, index);
        const absolutePath = resolve(outputRoot, relativePath);

        const sourceContent =
          parsed.map.sourcesContent && index < parsed.map.sourcesContent.length
            ? parsed.map.sourcesContent[index]
            : null;

        const fileContent =
          typeof sourceContent === 'string'
            ? sourceContent
            : `/* source content missing in source map: ${sourcePath} */\n`;

        try {
          await mkdir(dirname(absolutePath), { recursive: true });
          await writeFile(absolutePath, fileContent, 'utf-8');
          writtenFiles.push(relativePath);
        } catch {
          skippedFiles += 1;
        }
      }

      return this.json({
        outputDir: outputRootDisplay,
        totalSources: parsed.map.sources.length,
        writtenFiles: writtenFiles.length,
        skippedFiles,
        files: writtenFiles,
      });
    } catch (error) {
      return this.fail('sourcemap_reconstruct_tree', error);
    }
  }

  async handleExtensionListInstalled(
    _args: Record<string, unknown>
  ): Promise<TextToolResponse> {
    const page = await this.collector.getActivePage();
    const session = (await page.createCDPSession()) as unknown as CdpSessionLike;

    try {
      const targets = await this.getExtensionTargets(session);
      const result = targets.map((target) => ({
        extensionId: target.extensionId,
        name: target.name,
        type: target.type,
        url: target.url,
      }));
      return this.json(result);
    } catch (error) {
      return this.fail('extension_list_installed', error);
    } finally {
      await this.safeDetach(session);
    }
  }

  async handleExtensionExecuteInContext(
    args: Record<string, unknown>
  ): Promise<TextToolResponse> {
    const extensionId = this.requiredStringArg(args.extensionId, 'extensionId');
    const code = this.requiredStringArg(args.code, 'code');
    const returnByValue = this.parseBooleanArg(args.returnByValue, true);

    const page = await this.collector.getActivePage();
    const session = (await page.createCDPSession()) as unknown as CdpSessionLike;

    let attachedSessionId = '';

    try {
      const targets = await this.getExtensionTargets(session, extensionId);
      if (targets.length === 0) {
        throw new Error(`No background target found for extension: ${extensionId}`);
      }

      const preferred = this.pickPreferredExtensionTarget(targets);
      const attachResult = this.asRecord(
        await session.send('Target.attachToTarget', {
          targetId: preferred.targetId,
          flatten: true,
        })
      );
      attachedSessionId = this.requiredStringArg(
        attachResult.sessionId,
        'sessionId'
      );

      const evaluation = await this.evaluateInAttachedTarget(
        session,
        attachedSessionId,
        code,
        returnByValue
      );

      return this.json({
        extensionId,
        target: {
          type: preferred.type,
          url: preferred.url,
          name: preferred.name,
        },
        result: evaluation.result,
        exceptionDetails: evaluation.exceptionDetails,
      });
    } catch (error) {
      return this.fail('extension_execute_in_context', error);
    } finally {
      if (attachedSessionId) {
        await this.trySend(session, 'Target.detachFromTarget', {
          sessionId: attachedSessionId,
        });
      }
      await this.safeDetach(session);
    }
  }

  private async parseSourceMap(
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

  private async loadSourceMap(
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

  private normalizeSourceMap(value: unknown): SourceMapV3 {
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

  private decodeMappings(mappings: string): DecodedMapping[] {
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

  private decodeVlqSegment(segment: string): number[] {
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

  private fromVlqSigned(value: number): number {
    const isNegative = (value & 1) === 1;
    const shifted = value >> 1;
    return isNegative ? -shifted : shifted;
  }

  private async fetchSourceMapText(resolvedUrl: string): Promise<string> {
    // SSRF guard: block private/reserved network addresses on server-side fetch
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

  private validateFetchUrl(url: string): void {
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

    // Block private/reserved IP ranges
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
        throw new Error(`SSRF blocked: private/reserved IP "${hostname}" is not allowed`);
      }
    }
  }

  private decodeDataUriJson(dataUri: string): string {
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

  private resolveSourceMapUrl(sourceMapUrl: string, scriptUrl: string): string {
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

  private extractSourceMappingUrlFromScript(scriptSource: string): string | null {
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

  private async getExtensionTargets(
    session: CdpSessionLike,
    expectedExtensionId?: string
  ): Promise<ExtensionTarget[]> {
    const response = this.asRecord(await session.send('Target.getTargets'));
    const targetInfos = Array.isArray(response.targetInfos)
      ? response.targetInfos
      : [];

    const allowedTypes = new Set(['service_worker', 'background_page']);
    const result: ExtensionTarget[] = [];

    for (const item of targetInfos) {
      const record = this.asRecord(item);
      const targetId = this.asString(record.targetId);
      const type = this.asString(record.type);
      const url = this.asString(record.url);

      if (!targetId || !type || !url) {
        continue;
      }

      if (!allowedTypes.has(type)) {
        continue;
      }

      const extensionId = this.extractExtensionId(url);
      if (!extensionId) {
        continue;
      }

      if (expectedExtensionId && extensionId !== expectedExtensionId) {
        continue;
      }

      const title = this.asString(record.title) ?? '';
      result.push({
        targetId,
        extensionId,
        name: title || extensionId,
        type: type as 'service_worker' | 'background_page',
        url,
      });
    }

    result.sort((left, right) => {
      const leftScore = left.type === 'service_worker' ? 0 : 1;
      const rightScore = right.type === 'service_worker' ? 0 : 1;
      if (leftScore !== rightScore) {
        return leftScore - rightScore;
      }
      return left.extensionId.localeCompare(right.extensionId);
    });

    return result;
  }

  private pickPreferredExtensionTarget(targets: ExtensionTarget[]): ExtensionTarget {
    const serviceWorker = targets.find((target) => target.type === 'service_worker');
    return serviceWorker ?? targets[0]!;
  }

  private extractExtensionId(url: string): string | null {
    const match = url.match(/^chrome-extension:\/\/([a-p]{32})(?:\/|$)/i);
    return match?.[1] ?? null;
  }

  private async evaluateInAttachedTarget(
    session: CdpSessionLike,
    sessionId: string,
    code: string,
    returnByValue: boolean
  ): Promise<{ result: unknown; exceptionDetails: unknown }> {
    if (!session.on) {
      throw new Error('CDP session does not support event listeners');
    }

    const commandId = Date.now() % 1_000_000_000;
    const commandMessage = JSON.stringify({
      id: commandId,
      method: 'Runtime.evaluate',
      params: {
        expression: code,
        returnByValue,
        awaitPromise: true,
      },
    });

    const responseMessage = await new Promise<JsonRecord>((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        cleanup();
        rejectPromise(new Error('Runtime.evaluate timed out'));
      }, 15_000);

      const onMessage = (payload: unknown): void => {
        const record = this.asRecord(payload);
        const incomingSessionId = this.asString(record.sessionId);
        if (incomingSessionId !== sessionId) {
          return;
        }

        const rawMessage = this.asString(record.message);
        if (!rawMessage) {
          return;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(rawMessage);
        } catch {
          return;
        }

        const parsedRecord = this.asRecord(parsed);
        const incomingId = parsedRecord.id;
        if (incomingId !== commandId) {
          return;
        }

        cleanup();
        resolvePromise(parsedRecord);
      };

      const cleanup = (): void => {
        clearTimeout(timeout);
        session.off?.('Target.receivedMessageFromTarget', onMessage);
      };

      session.on?.('Target.receivedMessageFromTarget', onMessage);

      session
        .send('Target.sendMessageToTarget', {
          sessionId,
          message: commandMessage,
        })
        .catch((error) => {
          cleanup();
          rejectPromise(error);
        });
    });

    const errorRecord = this.asRecord(responseMessage.error);
    if (Object.keys(errorRecord).length > 0) {
      const errorMessage =
        this.asString(errorRecord.message) ??
        this.asString(errorRecord.data) ??
        'Runtime.evaluate failed';
      throw new Error(errorMessage);
    }

    const resultEnvelope = this.asRecord(responseMessage.result);
    const resultValue =
      resultEnvelope.result !== undefined ? resultEnvelope.result : null;
    const exceptionDetails =
      resultEnvelope.exceptionDetails !== undefined
        ? resultEnvelope.exceptionDetails
        : null;

    return {
      result: resultValue,
      exceptionDetails,
    };
  }

  private combineSourceRoot(sourceRoot: string | undefined, sourcePath: string): string {
    if (!sourceRoot) {
      return sourcePath;
    }

    if (!sourcePath) {
      return sourceRoot;
    }

    if (this.hasProtocol(sourcePath) || sourcePath.startsWith('/')) {
      return sourcePath;
    }

    if (this.hasProtocol(sourceRoot)) {
      try {
        const base = sourceRoot.endsWith('/') ? sourceRoot : `${sourceRoot}/`;
        return new URL(sourcePath, base).toString();
      } catch {
        return `${sourceRoot.replace(/\/+$/g, '')}/${sourcePath.replace(/^\/+/g, '')}`;
      }
    }

    return `${sourceRoot.replace(/\/+$/g, '')}/${sourcePath.replace(/^\/+/g, '')}`;
  }

  private normalizeSourcePath(sourcePath: string, index: number): string {
    let candidate = sourcePath.trim();
    if (!candidate) {
      return `source_${index + 1}.js`;
    }

    if (candidate.startsWith('webpack://')) {
      candidate = candidate.slice('webpack://'.length);
    }

    if (candidate.startsWith('data:')) {
      return `inline/source_${index + 1}.txt`;
    }

    if (this.hasProtocol(candidate)) {
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
      .map((segment) => this.sanitizePathSegment(segment))
      .filter((segment) => segment !== '' && segment !== '.' && segment !== '..');

    if (parts.length === 0) {
      return `source_${index + 1}.js`;
    }

    return parts.join('/');
  }

  private sanitizePathSegment(segment: string): string {
    const sanitized = segment
      .replace(/[<>:"|?*\u0000-\u001F]/g, '_')
      .replace(/\s+/g, ' ')
      .trim();

    if (!sanitized || sanitized === '.' || sanitized === '..') {
      return '_';
    }

    return sanitized;
  }

  private safeTarget(value: string): string {
    return value
      .replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 48);
  }

  private hasProtocol(value: string): boolean {
    return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
  }

  private parseBooleanArg(value: unknown, defaultValue: boolean): boolean {
    return typeof value === 'boolean' ? value : defaultValue;
  }

  private requiredStringArg(value: unknown, fieldName: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`${fieldName} is required`);
    }
    return value.trim();
  }

  private optionalStringArg(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private asRecord(value: unknown): JsonRecord {
    return typeof value === 'object' && value !== null ? (value as JsonRecord) : {};
  }

  private asString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }

  private async safeDetach(session: CdpSessionLike): Promise<void> {
    if (!session.detach) {
      return;
    }
    try {
      await session.detach();
    } catch {
      return;
    }
  }

  private async trySend(
    session: CdpSessionLike,
    method: string,
    params?: JsonRecord
  ): Promise<void> {
    try {
      await session.send(method, params);
    } catch {
      return;
    }
  }

  private async delay(ms: number): Promise<void> {
    await new Promise<void>((resolvePromise) => {
      setTimeout(() => resolvePromise(), ms);
    });
  }

  private json(payload: unknown): TextToolResponse {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(payload, null, 2),
        },
      ],
    };
  }

  private fail(tool: string, error: unknown): TextToolResponse {
    const message = error instanceof Error ? error.message : String(error);
    return this.json({
      success: false,
      tool,
      error: message,
    });
  }
}
