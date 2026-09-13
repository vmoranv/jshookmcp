import type { CDPSession } from 'rebrowser-puppeteer-core';
import type { CodeCollector } from '@modules/collector/CodeCollector';
import { setImmediate as waitForImmediate } from 'node:timers/promises';
import { logger } from '@utils/logger';
import { matchesWildcardPattern } from '@utils/matchesWildcardPattern';
import {
  extractFunctionTreeCore,
  type ExtractFunctionTreeResult,
} from '@modules/debugger/ScriptManager.impl.extract-function-tree';
import {
  SCRIPT_SEARCH_RESULT_LIMIT,
  SCRIPT_CONTEXT_TRUNCATE_LINES_LARGE,
  SCRIPT_CONTEXT_SNIPPET_HALF_LINES_LARGE,
  SCRIPT_CONTEXT_TRUNCATE_LINES_SMALL,
  SCRIPT_CONTEXT_SNIPPET_HALF_LINES_SMALL,
  SCRIPT_CONTEXT_HALF_LINES_SMALL,
} from '@src/constants';

/** Cap on the number of scripts scanned by searchInScripts. */
const SEARCH_RESULT_LIMIT = SCRIPT_SEARCH_RESULT_LIMIT;
/** Context truncation trigger for the searchInScripts path (chars). */
const CONTEXT_TRUNCATE_LINES_LARGE = SCRIPT_CONTEXT_TRUNCATE_LINES_LARGE;
/** Match-window half-width used when truncating the searchInScripts path. */
const CONTEXT_SNIPPET_HALF_LINES_LARGE = SCRIPT_CONTEXT_SNIPPET_HALF_LINES_LARGE;
/** Context truncation trigger for the keyword-index path (chars). */
const CONTEXT_TRUNCATE_LINES_SMALL = SCRIPT_CONTEXT_TRUNCATE_LINES_SMALL;
/** Match-window half-width used when truncating the keyword-index path. */
const CONTEXT_SNIPPET_HALF_LINES_SMALL = SCRIPT_CONTEXT_SNIPPET_HALF_LINES_SMALL;
/** Match-window half-width for the keyword-index path (lines). */
const CONTEXT_HALF_LINES_SMALL = SCRIPT_CONTEXT_HALF_LINES_SMALL;

/**
 * Build the match-window context for a keyword hit. Joins `halfWidth` lines
 * above/below the match line; when the joined window exceeds `truncateChars`
 * (a single huge bundle line), falls back to a `snippetHalfWidth`-char window
 * around the match index with `...` ellipses. Shared by searchInScripts and
 * buildKeywordIndex.
 */
function getContextWindow(
  lines: string[],
  line: string,
  lineIndex: number,
  matchIndex: number,
  halfWidth: number,
  truncateChars: number,
  snippetHalfWidth: number,
): string {
  const startLine = Math.max(0, lineIndex - halfWidth);
  const endLine = Math.min(lines.length - 1, lineIndex + halfWidth);
  let contextLength = endLine - startLine;
  for (let i = startLine; i <= endLine && contextLength <= truncateChars; i++) {
    contextLength += lines[i]!.length;
  }

  if (contextLength > truncateChars) {
    const snippetStart = Math.max(0, matchIndex - snippetHalfWidth);
    const snippetEnd = Math.min(line.length, matchIndex + snippetHalfWidth);
    return (
      (snippetStart > 0 ? '...' : '') +
      line.substring(snippetStart, snippetEnd) +
      (snippetEnd < line.length ? '...' : '')
    );
  }

  return lines.slice(startLine, endLine + 1).join('\n');
}

export interface ScriptInfo {
  scriptId: string;
  url: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  sourceLength?: number;
  source?: string;
}

interface ScriptChunk {
  scriptId: string;
  chunkIndex: number;
  content: string;
  size: number;
}

interface KeywordIndexEntry {
  scriptId: string;
  url: string;
  line: number;
  column: number;
  context: string;
}

interface DebuggerScriptParsedEvent {
  scriptId: string;
  url: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  length?: number;
}

export class ScriptManager {
  private collector: CodeCollector;
  private static readonly SOURCE_LOAD_BATCH_SIZE = 8;
  private static readonly SEARCH_LINE_YIELD_INTERVAL = 250;
  private static readonly SEARCH_SCRIPT_YIELD_INTERVAL = 10;
  private cdpSession: CDPSession | null = null;
  private scripts: Map<string, ScriptInfo> = new Map();
  private scriptsByUrl: Map<string, ScriptInfo[]> = new Map();
  private initialized = false;
  private initPromise?: Promise<void>;

  private keywordIndex: Map<string, KeywordIndexEntry[]> = new Map();
  private indexedScripts = new Map<ScriptInfo, Promise<void>>();
  private indexGeneration = 0;
  private scriptChunks: Map<string, ScriptChunk[]> = new Map();
  private readonly CHUNK_SIZE = 100 * 1024;
  private readonly MAX_KEYWORD_INDEX_ENTRIES = 50000;
  /** Throttle zombie-CDP probes — re-probe at most once per this interval. */
  private readonly CDP_HEALTH_PROBE_INTERVAL_MS = 30_000;
  private lastHealthProbeAt = 0;
  /** Serializes the zombie-detection → reinit path across concurrent callers. */
  private ensureSessionPromise?: Promise<void>;

  constructor(collector: CodeCollector) {
    this.collector = collector;
  }

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.doInit();
    try {
      return await this.initPromise;
    } finally {
      this.initPromise = undefined;
    }
  }

  private async doInit(): Promise<void> {
    const page = await this.collector.getActivePage();
    this.cdpSession = await page.createCDPSession();

    this.cdpSession.on('Debugger.scriptParsed', (params: DebuggerScriptParsedEvent) => {
      const scriptInfo: ScriptInfo = {
        scriptId: params.scriptId,
        url: params.url,
        startLine: params.startLine,
        startColumn: params.startColumn,
        endLine: params.endLine,
        endColumn: params.endColumn,
        sourceLength: params.length,
      };

      this.scripts.set(params.scriptId, scriptInfo);

      if (params.url) {
        if (!this.scriptsByUrl.has(params.url)) {
          this.scriptsByUrl.set(params.url, []);
        }
        this.scriptsByUrl.get(params.url)!.push(scriptInfo);
      }

      logger.debug(`Script parsed: ${params.url || 'inline'} (${params.scriptId})`);
    });

    await this.cdpSession.send('Debugger.enable');

    this.initialized = true;
    // Fresh init implies a working session; skip the next throttled probe.
    this.lastHealthProbeAt = Date.now();
    logger.info('ScriptManager initialized');
  }

  private async loadScriptSourceInternal(script: ScriptInfo): Promise<boolean> {
    if (script.source) {
      return true;
    }

    try {
      const { scriptSource } = await this.cdpSession!.send('Debugger.getScriptSource', {
        scriptId: script.scriptId,
      });
      script.source = scriptSource;
      script.sourceLength = scriptSource.length;

      this.chunkScript(script.scriptId, scriptSource);
      return true;
    } catch (error) {
      logger.warn(`Failed to get source for script ${script.scriptId}:`, error);
      return false;
    }
  }

  async enable(): Promise<void> {
    return this.init();
  }

  /**
   * Ensure the CDP session is healthy (non-zombie).
   * After a browser reattach, the old session reference may be non-null
   * while the underlying WebSocket is dead. The probe is throttled to
   * once per CDP_HEALTH_PROBE_INTERVAL_MS so hot-path callers don't pay
   * the round-trip on every invocation.
   */
  private async ensureCdpSession(): Promise<void> {
    if (!this.cdpSession || !this.initialized) {
      await this.init();
      return;
    }
    const now = Date.now();
    if (now - this.lastHealthProbeAt < this.CDP_HEALTH_PROBE_INTERVAL_MS) {
      return;
    }

    // Serialize the zombie path: concurrent probes failing at the same time
    // would otherwise clear each other's freshly-recreated session (one caller
    // nulls the session another just built), leaving this.cdpSession null.
    if (this.ensureSessionPromise) {
      await this.ensureSessionPromise;
      return;
    }
    // Capture the session under probe — the failure path must not wipe a
    // replacement a concurrent caller built while this probe was in flight.
    const probed = this.cdpSession;

    this.ensureSessionPromise = (async () => {
      try {
        // Keep the probe timer handle so it can be cleared once the race
        // settles — a dangling timer would keep the event loop alive until
        // the 3s timeout fires on an already-healthy session.
        let probeTimer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          probed.send('Runtime.evaluate', { expression: '1', returnByValue: true }),
          new Promise<never>((_, reject) => {
            probeTimer = setTimeout(() => reject(new Error('session_unreachable')), 3000);
          }),
        ]).finally(() => {
          if (probeTimer) clearTimeout(probeTimer);
        });
        this.lastHealthProbeAt = Date.now();
      } catch {
        logger.warn('ScriptManager CDP session unresponsive (zombie), reinitializing...');
        // Re-check before wiping: another caller may have already rebuilt or
        // replaced the session we probed.
        if (this.cdpSession !== probed || !this.initialized) {
          return;
        }
        this.cdpSession = null;
        this.initialized = false;
        this.lastHealthProbeAt = 0;
        this.scripts.clear();
        this.scriptsByUrl.clear();
        this.keywordIndex.clear();
        this.indexedScripts.clear();
        this.indexGeneration++;
        this.scriptChunks.clear();
        await this.init();
      }
    })();

    try {
      await this.ensureSessionPromise;
    } finally {
      this.ensureSessionPromise = undefined;
    }
  }

  async getAllScripts(includeSource = false, maxScripts = 1000): Promise<ScriptInfo[]> {
    await this.ensureCdpSession();

    const scripts = Array.from(this.scripts.values());

    if (scripts.length > maxScripts) {
      logger.warn(
        `Found ${scripts.length} scripts, limiting to ${maxScripts}. Increase maxScripts parameter if needed.`,
      );
    }

    const limitedScripts = scripts.slice(0, maxScripts);

    if (includeSource) {
      logger.warn(
        `Loading source code for ${limitedScripts.length} scripts. This may use significant memory.`,
      );

      let loadedCount = 0;
      let failedCount = 0;
      const missingScripts = limitedScripts.filter((script) => !script.source);

      for (
        let batchStart = 0;
        batchStart < missingScripts.length;
        batchStart += ScriptManager.SOURCE_LOAD_BATCH_SIZE
      ) {
        const batch = missingScripts.slice(
          batchStart,
          batchStart + ScriptManager.SOURCE_LOAD_BATCH_SIZE,
        );
        const settled = await Promise.allSettled(
          batch.map(async (script) => {
            const loaded = await this.loadScriptSourceInternal(script);
            if (loaded) {
              loadedCount++;
              if (loadedCount % 10 === 0) {
                logger.debug(`Loaded ${loadedCount}/${limitedScripts.length} scripts...`);
              }
            } else {
              failedCount++;
            }
          }),
        );

        for (const result of settled) {
          if (result.status === 'rejected') {
            failedCount++;
          }
        }

        await waitForImmediate();
      }

      logger.info(
        `getAllScripts: ${limitedScripts.length} scripts (loaded: ${loadedCount}, failed: ${failedCount})`,
      );
    } else {
      logger.info(`getAllScripts: ${limitedScripts.length} scripts (source not included)`);
    }

    return limitedScripts;
  }

  async getScriptSource(scriptId?: string, url?: string): Promise<ScriptInfo | null> {
    if (!scriptId && !url) {
      throw new Error('Either scriptId or url parameter must be provided');
    }

    await this.ensureCdpSession();

    let targetScript: ScriptInfo | undefined;

    if (scriptId) {
      targetScript = this.scripts.get(scriptId);
    } else if (url) {
      for (const [scriptUrl, scripts] of this.scriptsByUrl.entries()) {
        if (matchesWildcardPattern(scriptUrl, url)) {
          targetScript = scripts[0];
          break;
        }
      }
    }

    if (!targetScript) {
      logger.warn(`Script not found: ${scriptId || url}`);
      return null;
    }

    if (!targetScript.source) {
      const loaded = await this.loadScriptSourceInternal(targetScript);
      if (!loaded) {
        logger.error(`Failed to get script source for ${targetScript.scriptId}`);
        return null;
      }
    }

    logger.info(
      `getScriptSource: ${targetScript.url || 'inline'} (${targetScript.sourceLength} bytes)`,
    );
    return targetScript;
  }

  async findScriptsByUrl(urlPattern: string): Promise<ScriptInfo[]> {
    await this.ensureCdpSession();

    const results: ScriptInfo[] = [];

    for (const [url, scripts] of this.scriptsByUrl.entries()) {
      if (matchesWildcardPattern(url, urlPattern)) {
        results.push(...scripts);
      }
    }

    logger.info(`findScriptsByUrl: ${urlPattern} - found ${results.length} scripts`);
    return results;
  }

  clearCache(): void {
    this.clear();
  }

  async searchInScripts(
    keyword: string,
    options: {
      isRegex?: boolean;
      caseSensitive?: boolean;
      contextLines?: number;
      maxMatches?: number;
      signal?: AbortSignal;
      timeoutMs?: number;
    } = {},
  ): Promise<{
    keyword: string;
    totalMatches: number;
    matches: Array<{
      scriptId: string;
      url: string;
      line: number;
      column: number;
      matchText: string;
      context: string;
    }>;
  }> {
    const deadline = performance.now() + (options.timeoutMs ?? 30_000);
    const checkCancellation = () => {
      options.signal?.throwIfAborted();
      if (performance.now() >= deadline) throw new Error('Script search execution timed out');
    };
    checkCancellation();
    await this.ensureCdpSession();

    const { isRegex = false, caseSensitive = false, contextLines = 3, maxMatches = 100 } = options;

    const searchRegex = isRegex
      ? new RegExp(keyword, caseSensitive ? 'g' : 'gi')
      : new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi');

    const matches: Array<{
      scriptId: string;
      url: string;
      line: number;
      column: number;
      matchText: string;
      context: string;
    }> = [];

    const scripts = await this.getAllScripts(false, SEARCH_RESULT_LIMIT);

    for (const [scriptIndex, script] of scripts.entries()) {
      checkCancellation();
      if (matches.length >= maxMatches) break;
      if (!script.source && !(await this.loadScriptSourceInternal(script))) continue;
      checkCancellation();

      const lines = script.source!.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;

        for (const match of line.matchAll(searchRegex)) {
          if (matches.length >= maxMatches) break;
          if (matches.length % 256 === 0) {
            await waitForImmediate();
            checkCancellation();
          }

          const context = getContextWindow(
            lines,
            line,
            i,
            match.index || 0,
            contextLines,
            CONTEXT_TRUNCATE_LINES_LARGE,
            CONTEXT_SNIPPET_HALF_LINES_LARGE,
          );

          matches.push({
            scriptId: script.scriptId,
            url: script.url || 'inline',
            line: i + 1,
            column: match.index || 0,
            matchText: match[0],
            context,
          });
          if (matches.length >= maxMatches) break;
        }

        if (matches.length >= maxMatches) break;

        if ((i + 1) % ScriptManager.SEARCH_LINE_YIELD_INTERVAL === 0) {
          await waitForImmediate();
          checkCancellation();
        }
      }

      if ((scriptIndex + 1) % ScriptManager.SEARCH_SCRIPT_YIELD_INTERVAL === 0) {
        await waitForImmediate();
      }
    }

    checkCancellation();
    logger.info(`searchInScripts: "${keyword}" - found ${matches.length} matches`);

    return {
      keyword,
      totalMatches: matches.length,
      matches,
    };
  }

  async extractFunctionTree(
    scriptId: string,
    functionName: string,
    options: {
      maxDepth?: number;
      maxSize?: number;
      includeComments?: boolean;
    } = {},
  ): Promise<ExtractFunctionTreeResult> {
    return extractFunctionTreeCore(this, scriptId, functionName, options);
  }

  clear(): void {
    this.scripts.clear();
    this.scriptsByUrl.clear();
    this.keywordIndex.clear();
    this.indexedScripts.clear();
    this.indexGeneration++;
    this.scriptChunks.clear();
    logger.info(' ScriptManager cleared - ready for new website');
  }

  async close(): Promise<void> {
    this.initPromise = undefined;
    this.clear();

    if (this.cdpSession) {
      try {
        await this.cdpSession.send('Debugger.disable');
        await this.cdpSession.detach();
        logger.info('CDP session closed');
      } catch (error) {
        logger.warn('Failed to close CDP session:', error);
      }
      this.cdpSession = null;
    }

    this.initialized = false;
    logger.info(' ScriptManager closed');
  }

  getStats(): {
    totalScripts: number;
    totalUrls: number;
    indexedKeywords: number;
    totalChunks: number;
  } {
    let totalChunks = 0;
    for (const chunks of this.scriptChunks.values()) {
      totalChunks += chunks.length;
    }

    return {
      totalScripts: this.scripts.size,
      totalUrls: this.scriptsByUrl.size,
      indexedKeywords: this.keywordIndex.size,
      totalChunks,
    };
  }

  private async buildKeywordIndex(scriptId: string, url: string, content: string): Promise<void> {
    const lines = content.split('\n');
    const keywordRegex = /\b[a-zA-Z_$][a-zA-Z0-9_$]{2,}\b/g;
    let indexedCount = 0;
    const generation = this.indexGeneration;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      for (const match of line.matchAll(keywordRegex)) {
        const keyword = match[0].toLowerCase();

        const context = getContextWindow(
          lines,
          line,
          i,
          match.index || 0,
          CONTEXT_HALF_LINES_SMALL,
          CONTEXT_TRUNCATE_LINES_SMALL,
          CONTEXT_SNIPPET_HALF_LINES_SMALL,
        );

        const entry: KeywordIndexEntry = {
          scriptId,
          url,
          line: i + 1,
          column: match.index || 0,
          context,
        };

        if (!this.keywordIndex.has(keyword)) {
          this.keywordIndex.set(keyword, []);
        }
        this.keywordIndex.get(keyword)!.push(entry);
        if (++indexedCount % 256 === 0) {
          await waitForImmediate();
          if (generation !== this.indexGeneration) return;
        }
      }
    }

    logger.debug(` Indexed ${this.keywordIndex.size} keywords for ${url}`);

    // Evict oldest entries when keyword index exceeds capacity
    if (this.keywordIndex.size > this.MAX_KEYWORD_INDEX_ENTRIES) {
      const excess = this.keywordIndex.size - this.MAX_KEYWORD_INDEX_ENTRIES;
      let evicted = 0;
      for (const [key] of this.keywordIndex) {
        if (evicted >= excess) break;
        this.keywordIndex.delete(key);
        evicted++;
      }
      logger.debug(
        ` Keyword index pruned ${evicted} entries (cap: ${this.MAX_KEYWORD_INDEX_ENTRIES})`,
      );
    }
  }

  private chunkScript(scriptId: string, content: string): void {
    const chunks: ScriptChunk[] = [];
    let offset = 0;
    let chunkIndex = 0;

    while (offset < content.length) {
      const chunk = content.substring(offset, offset + this.CHUNK_SIZE);
      chunks.push({
        scriptId,
        chunkIndex,
        content: chunk,
        size: chunk.length,
      });
      offset += this.CHUNK_SIZE;
      chunkIndex++;
    }

    this.scriptChunks.set(scriptId, chunks);
    logger.debug(` Chunked script ${scriptId} into ${chunks.length} chunks`);
  }

  getScriptChunk(scriptId: string, chunkIndex: number): string | null {
    const chunks = this.scriptChunks.get(scriptId);
    if (!chunks || chunkIndex >= chunks.length) {
      return null;
    }
    const chunk = chunks[chunkIndex];
    return chunk ? chunk.content : null;
  }

  async searchInScriptsEnhanced(
    keyword: string,
    options: {
      isRegex?: boolean;
      caseSensitive?: boolean;
      contextLines?: number;
      maxMatches?: number;
    } = {},
  ): Promise<{
    keyword: string;
    totalMatches: number;
    matches: Array<{
      scriptId: string;
      url: string;
      line: number;
      column: number;
      matchText: string;
      context: string;
    }>;
    searchMethod: 'indexed' | 'regex';
  }> {
    const { isRegex = false, caseSensitive = false, maxMatches = 100 } = options;

    const searchTerm = caseSensitive ? keyword : keyword.toLowerCase();
    const matches: Array<{
      scriptId: string;
      url: string;
      line: number;
      column: number;
      matchText: string;
      context: string;
    }> = [];

    if (!isRegex) {
      // Index only already-loaded sources, preserving the enhanced search scope.
      for (const script of this.scripts.values()) {
        if (script.source) {
          let indexing = this.indexedScripts.get(script);
          if (!indexing) {
            indexing = this.buildKeywordIndex(script.scriptId, script.url, script.source);
            this.indexedScripts.set(script, indexing);
          }
          await indexing;
        }
      }
      for (const [indexedKeyword, entries] of this.keywordIndex.entries()) {
        if (indexedKeyword.includes(searchTerm)) {
          for (const entry of entries) {
            matches.push({
              scriptId: entry.scriptId,
              url: entry.url,
              line: entry.line,
              column: entry.column,
              matchText: indexedKeyword,
              context: entry.context,
            });

            if (matches.length >= maxMatches) {
              break;
            }
          }
        }

        if (matches.length >= maxMatches) {
          break;
        }
      }

      logger.info(` Enhanced search (indexed) found ${matches.length} matches for "${keyword}"`);

      return {
        keyword,
        totalMatches: matches.length,
        matches,
        searchMethod: 'indexed',
      };
    } else {
      const result = await this.searchInScripts(keyword, options);
      return {
        ...result,
        searchMethod: 'regex',
      };
    }
  }
}
