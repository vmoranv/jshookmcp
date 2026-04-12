import type { CDPSession } from 'rebrowser-puppeteer-core';
import type { CodeCollector } from '@modules/collector/CodeCollector';
import { setImmediate as waitForImmediate } from 'node:timers/promises';
import { logger } from '@utils/logger';
import {
  extractFunctionTreeCore,
  type ExtractFunctionTreeResult,
} from '@modules/debugger/ScriptManager.impl.extract-function-tree';

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
  private static readonly SOURCE_LOAD_BATCH_SIZE = 8;
  private static readonly SEARCH_LINE_YIELD_INTERVAL = 250;
  private static readonly SEARCH_SCRIPT_YIELD_INTERVAL = 10;
  private cdpSession: CDPSession | null = null;
  private scripts: Map<string, ScriptInfo> = new Map();
  private scriptsByUrl: Map<string, ScriptInfo[]> = new Map();
  private initialized = false;
  private initPromise?: Promise<void>;

  private keywordIndex: Map<string, KeywordIndexEntry[]> = new Map();
  private scriptChunks: Map<string, ScriptChunk[]> = new Map();
  private readonly CHUNK_SIZE = 100 * 1024;

  constructor(private collector: CodeCollector) {}

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

    await this.cdpSession.send('Debugger.enable');

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

    this.initialized = true;
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

      this.buildKeywordIndex(script.scriptId, script.url, scriptSource);
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

  async getAllScripts(includeSource = false, maxScripts = 1000): Promise<ScriptInfo[]> {
    if (!this.cdpSession) {
      await this.init();
    }

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

    if (!this.cdpSession) {
      await this.init();
    }

    let targetScript: ScriptInfo | undefined;

    if (scriptId) {
      targetScript = this.scripts.get(scriptId);
    } else if (url) {
      const urlPattern = url.replace(/\*/g, '.*');
      const regex = new RegExp(urlPattern);

      for (const [scriptUrl, scripts] of this.scriptsByUrl.entries()) {
        if (regex.test(scriptUrl)) {
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
    if (!this.cdpSession) {
      await this.init();
    }

    const pattern = urlPattern.replace(/\*/g, '.*');
    const regex = new RegExp(pattern);
    const results: ScriptInfo[] = [];

    for (const [url, scripts] of this.scriptsByUrl.entries()) {
      if (regex.test(url)) {
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
    if (!this.cdpSession) {
      await this.init();
    }

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

    const scripts = await this.getAllScripts(true, 500);

    for (const [scriptIndex, script] of scripts.entries()) {
      if (!script.source) continue;
      if (matches.length >= maxMatches) break;

      const lines = script.source.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;

        const lineMatches = Array.from(line.matchAll(searchRegex));

        for (const match of lineMatches) {
          if (matches.length >= maxMatches) break;

          const startLine = Math.max(0, i - contextLines);
          const endLine = Math.min(lines.length - 1, i + contextLines);
          const contextArray = lines.slice(startLine, endLine + 1);
          let context = contextArray.join('\n');

          if (context.length > 2000) {
            const matchIndex = match.index || 0;
            // On a huge single-line bundle, extract a safe window around the match
            const snippetStart = Math.max(0, matchIndex - 100);
            const snippetEnd = Math.min(line.length, matchIndex + 100);
            context =
              (snippetStart > 0 ? '...' : '') +
              line.substring(snippetStart, snippetEnd) +
              (snippetEnd < line.length ? '...' : '');
          }

          matches.push({
            scriptId: script.scriptId,
            url: script.url || 'inline',
            line: i + 1,
            column: match.index || 0,
            matchText: match[0],
            context,
          });
        }

        if ((i + 1) % ScriptManager.SEARCH_LINE_YIELD_INTERVAL === 0) {
          await waitForImmediate();
        }
      }

      if ((scriptIndex + 1) % ScriptManager.SEARCH_SCRIPT_YIELD_INTERVAL === 0) {
        await waitForImmediate();
      }
    }

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

  private buildKeywordIndex(scriptId: string, url: string, content: string): void {
    const lines = content.split('\n');
    const keywordRegex = /\b[a-zA-Z_$][a-zA-Z0-9_$]{2,}\b/g;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      const matches = Array.from(line.matchAll(keywordRegex));

      for (const match of matches) {
        const keyword = match[0].toLowerCase();

        const startLine = Math.max(0, i - 3);
        const endLine = Math.min(lines.length - 1, i + 3);
        let context = lines.slice(startLine, endLine + 1).join('\n');

        if (context.length > 1000) {
          const matchIndex = match.index || 0;
          const snippetStart = Math.max(0, matchIndex - 50);
          const snippetEnd = Math.min(line.length, matchIndex + 50);
          context =
            (snippetStart > 0 ? '...' : '') +
            line.substring(snippetStart, snippetEnd) +
            (snippetEnd < line.length ? '...' : '');
        }

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
      }
    }

    logger.debug(` Indexed ${this.keywordIndex.size} keywords for ${url}`);
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
