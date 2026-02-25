import { logger } from '../../../utils/logger.js';
import type { ToolArgs, ToolResponse } from '../../types.js';
import { asJsonResponse, asTextResponse, asErrorResponse, serializeError } from '../shared/response.js';
import { CodeCollector } from '../../../modules/collector/CodeCollector.js';
import { ScriptManager } from '../../../modules/debugger/ScriptManager.js';
import { Deobfuscator } from '../../../modules/deobfuscator/Deobfuscator.js';
import { AdvancedDeobfuscator } from '../../../modules/deobfuscator/AdvancedDeobfuscator.js';
import { ASTOptimizer } from '../../../modules/deobfuscator/ASTOptimizer.js';
import { ObfuscationDetector } from '../../../modules/detector/ObfuscationDetector.js';
import { CodeAnalyzer } from '../../../modules/analyzer/CodeAnalyzer.js';
import { CryptoDetector } from '../../../modules/crypto/CryptoDetector.js';
import { HookManager } from '../../../modules/hook/HookManager.js';

interface CoreAnalysisHandlerDeps {
  collector: CodeCollector;
  scriptManager: ScriptManager;
  deobfuscator: Deobfuscator;
  advancedDeobfuscator: AdvancedDeobfuscator;
  astOptimizer: ASTOptimizer;
  obfuscationDetector: ObfuscationDetector;
  analyzer: CodeAnalyzer;
  cryptoDetector: CryptoDetector;
  hookManager: HookManager;
}

export class CoreAnalysisHandlers {
  private readonly collector: CodeCollector;
  private readonly scriptManager: ScriptManager;
  private readonly deobfuscator: Deobfuscator;
  private readonly advancedDeobfuscator: AdvancedDeobfuscator;
  private readonly astOptimizer: ASTOptimizer;
  private readonly obfuscationDetector: ObfuscationDetector;
  private readonly analyzer: CodeAnalyzer;
  private readonly cryptoDetector: CryptoDetector;
  private readonly hookManager: HookManager;

  constructor(deps: CoreAnalysisHandlerDeps) {
    this.collector = deps.collector;
    this.scriptManager = deps.scriptManager;
    this.deobfuscator = deps.deobfuscator;
    this.advancedDeobfuscator = deps.advancedDeobfuscator;
    this.astOptimizer = deps.astOptimizer;
    this.obfuscationDetector = deps.obfuscationDetector;
    this.analyzer = deps.analyzer;
    this.cryptoDetector = deps.cryptoDetector;
    this.hookManager = deps.hookManager;
  }

  private requireCodeArg(args: ToolArgs, toolName: string): string | null {
    const code = args.code;
    if (typeof code !== 'string' || code.trim().length === 0) {
      logger.warn(`${toolName} called without valid code argument`);
      return null;
    }
    return code;
  }

  async handleCollectCode(args: ToolArgs): Promise<ToolResponse> {
    const returnSummaryOnly = (args.returnSummaryOnly as boolean) ?? false;
    let smartMode = args.smartMode as 'summary' | 'priority' | 'incremental' | 'full' | undefined;
    const maxSummaryFiles = 40;

    const summarizeFiles = (files: Array<{ url: string; type: string; size: number; content: string; metadata?: { truncated?: boolean } }>) =>
      files.slice(0, maxSummaryFiles).map((file) => ({
        url: file.url,
        type: file.type,
        size: file.size,
        sizeKB: (file.size / 1024).toFixed(2),
        truncated: file.metadata?.truncated || false,
        preview: `${file.content.substring(0, 200)}...`,
      }));

    if (returnSummaryOnly && !smartMode) {
      smartMode = 'summary';
    }

    const result = await this.collector.collect({
      url: args.url as string,
      includeInline: args.includeInline as boolean | undefined,
      includeExternal: args.includeExternal as boolean | undefined,
      includeDynamic: args.includeDynamic as boolean | undefined,
      smartMode,
      compress: args.compress as boolean | undefined,
      maxTotalSize: args.maxTotalSize as number | undefined,
      maxFileSize: args.maxFileSize ? (args.maxFileSize as number) * 1024 : undefined,
      priorities: args.priorities as string[] | undefined,
    });

    if (returnSummaryOnly) {
      return asJsonResponse({
        mode: 'summary',
        totalSize: result.totalSize,
        totalSizeKB: (result.totalSize / 1024).toFixed(2),
        filesCount: result.files.length,
        summarizedFiles: Math.min(result.files.length, maxSummaryFiles),
        omittedFiles: Math.max(0, result.files.length - maxSummaryFiles),
        collectTime: result.collectTime,
        summary: summarizeFiles(
          result.files as Array<{
            url: string;
            type: string;
            size: number;
            content: string;
            metadata?: { truncated?: boolean };
          }>
        ),
        hint: 'Use get_script_source for specific files.',
      });
    }

    const maxSafeCollectedSize = 256 * 1024;
    const maxSafeResponseSize = 220 * 1024;
    const estimatedResponseSize = Buffer.byteLength(JSON.stringify(result), 'utf8');

    if (result.totalSize > maxSafeCollectedSize || estimatedResponseSize > maxSafeResponseSize) {
      logger.warn(
        `Collected code is too large (collected=${(result.totalSize / 1024).toFixed(2)}KB, response=${(estimatedResponseSize / 1024).toFixed(2)}KB), returning summary mode.`
      );

      return asJsonResponse({
        warning: 'Code size exceeds safe response threshold; summary returned.',
        totalSize: result.totalSize,
        totalSizeKB: (result.totalSize / 1024).toFixed(2),
        estimatedResponseSize,
        estimatedResponseSizeKB: (estimatedResponseSize / 1024).toFixed(2),
        filesCount: result.files.length,
        summarizedFiles: Math.min(result.files.length, maxSummaryFiles),
        omittedFiles: Math.max(0, result.files.length - maxSummaryFiles),
        collectTime: result.collectTime,
        summary: summarizeFiles(
          result.files as Array<{
            url: string;
            type: string;
            size: number;
            content: string;
            metadata?: { truncated?: boolean };
          }>
        ),
        recommendations: [
          'Use get_script_source for targeted files.',
          'Use more specific priority filters.',
          'Use smartMode=summary for initial reconnaissance.',
        ],
      });
    }

    return asJsonResponse(result);
  }

  async handleSearchInScripts(args: ToolArgs): Promise<ToolResponse> {
    await this.scriptManager.init();

    const keyword = args.keyword as string | undefined;
    if (!keyword) {
      return asJsonResponse({ success: false, error: 'keyword is required' });
    }

    const maxMatches = (args.maxMatches as number) ?? 100;
    const returnSummary = (args.returnSummary as boolean) ?? false;
    const maxContextSize = (args.maxContextSize as number) ?? 50000;

    const result = await this.scriptManager.searchInScripts(keyword, {
      isRegex: args.isRegex as boolean,
      caseSensitive: args.caseSensitive as boolean,
      contextLines: args.contextLines as number,
      maxMatches,
    });

    const resultSize = JSON.stringify(result).length;
    const shouldSummarize = returnSummary || resultSize > maxContextSize;

    if (shouldSummarize) {
      return asJsonResponse({
        success: true,
        keyword: args.keyword,
        totalMatches: result.matches?.length || 0,
        resultSize,
        resultSizeKB: (resultSize / 1024).toFixed(2),
        truncated: resultSize > maxContextSize,
        reason:
          resultSize > maxContextSize
            ? `Result too large (${(resultSize / 1024).toFixed(2)}KB > ${(maxContextSize / 1024).toFixed(2)}KB)`
            : 'Summary mode enabled',
        matchesSummary: (result.matches || []).slice(0, 10).map((match: any) => ({
          scriptId: match.scriptId,
          url: match.url,
          line: match.line,
          preview: `${match.context?.substring(0, 100)}...`,
        })),
        recommendations: [
          'Use more specific keywords.',
          `Reduce maxMatches (current: ${maxMatches}).`,
          'Use get_script_source for targeted file retrieval.',
        ],
      });
    }

    return asJsonResponse(result);
  }

  async handleExtractFunctionTree(args: ToolArgs): Promise<ToolResponse> {
    const scriptId = args.scriptId as string;
    const functionName = args.functionName as string;

    // Validate required parameters
    if (!scriptId) {
      return asJsonResponse({
        success: false,
        error: 'scriptId is required',
        hint: 'Use get_all_scripts() to list available scripts and their scriptIds',
      });
    }

    if (!functionName) {
      return asJsonResponse({
        success: false,
        error: 'functionName is required',
        hint: 'Specify the name of the function to extract',
      });
    }

    await this.scriptManager.init();

    // Check if script exists before attempting extraction
    const scripts = await this.scriptManager.getAllScripts();
    const scriptExists = scripts.some(s => String(s.scriptId) === String(scriptId));

    if (!scriptExists) {
      const availableScripts = scripts.slice(0, 10).map(s => ({
        scriptId: s.scriptId,
        url: s.url?.substring(0, 80),
      }));

      return asJsonResponse({
        success: false,
        error: `Script not found: ${scriptId}`,
        hint: 'The specified scriptId does not exist. Use get_all_scripts() to list available scripts.',
        availableScripts: availableScripts.length > 0 ? availableScripts : 'No scripts loaded. Navigate to a page first.',
        totalScripts: scripts.length,
      });
    }

    try {
      const result = await this.scriptManager.extractFunctionTree(
        scriptId,
        functionName,
        {
          maxDepth: args.maxDepth as number,
          maxSize: args.maxSize as number,
          includeComments: args.includeComments as boolean,
        }
      );
      return asJsonResponse({ success: true, ...result });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return asJsonResponse({
        success: false,
        error: errorMsg,
        hint: 'Make sure the function name exists in the specified script',
      });
    }
  }

  async handleDeobfuscate(args: ToolArgs): Promise<ToolResponse> {
    const code = this.requireCodeArg(args, 'deobfuscate');
    if (!code) {
      return asJsonResponse({
        success: false,
        error: 'code is required and must be a non-empty string',
      });
    }

    const result = await this.deobfuscator.deobfuscate({
      code,
      llm: args.llm as 'gpt-4' | 'claude' | undefined,
      aggressive: args.aggressive as boolean | undefined,
    });

    return asJsonResponse(result);
  }

  async handleUnderstandCode(args: ToolArgs): Promise<ToolResponse> {
    const code = this.requireCodeArg(args, 'understand_code');
    if (!code) {
      return asJsonResponse({
        success: false,
        error: 'code is required and must be a non-empty string',
      });
    }

    const result = await this.analyzer.understand({
      code,
      context: args.context as Record<string, unknown> | undefined,
      focus: (args.focus as 'structure' | 'business' | 'security' | 'all') || 'all',
    });

    return asJsonResponse(result);
  }

  async handleDetectCrypto(args: ToolArgs): Promise<ToolResponse> {
    const code = this.requireCodeArg(args, 'detect_crypto');
    if (!code) {
      return asJsonResponse({
        success: false,
        error: 'code is required and must be a non-empty string',
      });
    }

    const result = await this.cryptoDetector.detect({
      code,
    });

    return asJsonResponse(result);
  }

  async handleManageHooks(args: ToolArgs): Promise<ToolResponse> {
    const action = args.action as string;

    switch (action) {
      case 'create': {
        const result = await this.hookManager.createHook({
          target: args.target as string,
          type: args.type as 'function' | 'xhr' | 'fetch' | 'websocket' | 'localstorage' | 'cookie',
          action: (args.hookAction as 'log' | 'block' | 'modify') || 'log',
          customCode: args.customCode as string | undefined,
        });
        return asJsonResponse(result);
      }
      case 'list':
        return asJsonResponse({ hooks: this.hookManager.getAllHooks() });
      case 'records':
        return asJsonResponse({
          records: this.hookManager.getHookRecords(args.hookId as string),
        });
      case 'clear':
        this.hookManager.clearHookRecords(args.hookId as string | undefined);
        return asJsonResponse({ success: true, message: 'Hook records cleared' });
      default:
        throw new Error(`Unknown hook action: ${action}`);
    }
  }

  async handleDetectObfuscation(args: ToolArgs): Promise<ToolResponse> {
    const code = this.requireCodeArg(args, 'detect_obfuscation');
    if (!code) {
      return asJsonResponse({
        success: false,
        error: 'code is required and must be a non-empty string',
      });
    }

    const generateReport = (args.generateReport as boolean) ?? true;
    const result = this.obfuscationDetector.detect(code);

    if (!generateReport) {
      return asJsonResponse(result);
    }

    const report = this.obfuscationDetector.generateReport(result);
    return asTextResponse(`${JSON.stringify(result, null, 2)}\n\n${report}`);
  }

  async handleAdvancedDeobfuscate(args: ToolArgs): Promise<ToolResponse> {
    const code = this.requireCodeArg(args, 'advanced_deobfuscate');
    if (!code) {
      return asJsonResponse({
        success: false,
        error: 'code is required and must be a non-empty string',
      });
    }

    const detectOnly = (args.detectOnly as boolean) ?? false;
    const aggressiveVM = (args.aggressiveVM as boolean) ?? false;
    const useASTOptimization = (args.useASTOptimization as boolean) ?? true;
    const timeout = (args.timeout as number) ?? 60000;

    const result = await this.advancedDeobfuscator.deobfuscate({
      code,
      detectOnly,
      aggressiveVM,
      timeout,
    });

    let finalCode = result.code;
    if (useASTOptimization && !detectOnly) {
      finalCode = this.astOptimizer.optimize(finalCode);
    }

    return asJsonResponse({
      ...result,
      code: finalCode,
      astOptimized: useASTOptimization && !detectOnly,
    });
  }

  async handleWebpackEnumerate(args: ToolArgs): Promise<ToolResponse> {
    const searchKeyword = (args.searchKeyword as string | undefined) ?? '';
    const forceRequireAll = (args.forceRequireAll as boolean | undefined) ?? !!searchKeyword;
    const maxResults = (args.maxResults as number | undefined) ?? 20;

    try {
      const page = await this.collector.getActivePage();
      const result = await page.evaluate(
        async (opts: { searchKeyword: string; forceRequireAll: boolean; maxResults: number }) => {
          const w = window as unknown as Record<string, unknown>;

          // Locate __webpack_require__
          let requireFn: ((id: string) => unknown) | null = null;
          if (typeof w['__webpack_require__'] === 'function') {
            requireFn = w['__webpack_require__'] as (id: string) => unknown;
          }

          // Collect all known module IDs from webpackChunk* / webpackJsonp* arrays
          const chunkKeys = Object.keys(w).filter(
            (k) => k.startsWith('webpackChunk') || k.startsWith('webpackJsonp')
          );

          const moduleIdSet = new Set<string>();

          for (const key of chunkKeys) {
            const arr = w[key];
            if (!Array.isArray(arr)) continue;
            const arrWithM = arr as unknown as { m?: Record<string, unknown> };
            if (arrWithM.m && typeof arrWithM.m === 'object') {
              for (const id of Object.keys(arrWithM.m)) moduleIdSet.add(id);
            }
            for (const chunk of arr as unknown[]) {
              if (Array.isArray(chunk) && chunk[1] && typeof chunk[1] === 'object') {
                for (const id of Object.keys(chunk[1] as Record<string, unknown>)) {
                  moduleIdSet.add(id);
                }
              }
            }
          }

          // Fallback: __webpack_modules__
          if (typeof w['__webpack_modules__'] === 'object' && w['__webpack_modules__']) {
            for (const id of Object.keys(w['__webpack_modules__'] as Record<string, unknown>)) {
              moduleIdSet.add(id);
            }
          }

          // Try to find require via .m property on chunk arrays
          if (!requireFn) {
            for (const key of chunkKeys) {
              const arr = w[key] as unknown as { m?: Record<string, unknown> };
              if (arr && arr.m && typeof arr.m === 'object') {
                const mods = arr.m;
                requireFn = (id: string) => {
                  try {
                    const fn = mods[id];
                    return typeof fn === 'function' ? (fn as () => unknown)() : fn;
                  } catch {
                    return undefined;
                  }
                };
                break;
              }
            }
          }

          const allIds = Array.from(moduleIdSet);

          if (!opts.forceRequireAll || !requireFn) {
            return {
              total: allIds.length,
              requireFound: !!requireFn,
              chunkKeys,
              moduleIds: allIds.slice(0, 200),
              matches: [] as Array<{ id: string; preview: string }>,
            };
          }

          // Search exports
          const fn = requireFn;
          const matches: Array<{ id: string; preview: string }> = [];
          for (const id of allIds) {
            if (matches.length >= opts.maxResults) break;
            try {
              const mod = fn(id);
              if (mod === undefined || mod === null) continue;
              let str: string;
              try {
                str = JSON.stringify(mod);
              } catch {
                str = String(mod);
              }
              if (!opts.searchKeyword || str.toLowerCase().includes(opts.searchKeyword.toLowerCase())) {
                matches.push({ id, preview: str.slice(0, 600) });
              }
            } catch {
              // module threw on require
            }
          }

          return {
            total: allIds.length,
            requireFound: true,
            chunkKeys,
            moduleIds: allIds.slice(0, 200),
            matches,
          };
        },
        { searchKeyword, forceRequireAll, maxResults }
      );

      logger.info(`webpack_enumerate: found ${result.total} modules, ${result.matches.length} matches`);
      return asJsonResponse(result);
    } catch (error) {
      return asErrorResponse(error);
    }
  }

  async handleSourceMapExtract(args: ToolArgs): Promise<ToolResponse> {
    const includeContent = (args.includeContent as boolean | undefined) ?? false;
    const filterPath = (args.filterPath as string | undefined) ?? '';
    const maxFiles = (args.maxFiles as number | undefined) ?? 50;

    try {
      const page = await this.collector.getActivePage();
      const result = await page.evaluate(
        async (opts: { includeContent: boolean; filterPath: string; maxFiles: number }) => {
          const scriptUrls = Array.from(document.querySelectorAll('script[src]'))
            .map((s) => (s as HTMLScriptElement).src)
            .filter(Boolean);

          type SourceEntry = { path: string; scriptUrl: string; content?: string };
          const files: SourceEntry[] = [];

          type SourceMapJson = { sources?: string[]; sourcesContent?: (string | null | undefined)[] };

          const processMapData = (mapData: SourceMapJson, scriptUrl: string): void => {
            if (!mapData.sources) return;
            for (let i = 0; i < mapData.sources.length; i++) {
              if (files.length >= opts.maxFiles) break;
              const sourcePath = mapData.sources[i];
              if (!sourcePath) continue;
              if (opts.filterPath && !sourcePath.includes(opts.filterPath)) continue;
              const entry: SourceEntry = { path: sourcePath, scriptUrl };
              if (opts.includeContent && mapData.sourcesContent) {
                const c = mapData.sourcesContent[i];
                if (c) entry.content = c;
              }
              files.push(entry);
            }
          };

          for (const scriptUrl of scriptUrls) {
            if (files.length >= opts.maxFiles) break;
            try {
              const resp = await fetch(scriptUrl, { cache: 'force-cache' });
              const text = await resp.text();
              const match = text.match(/\/\/# sourceMappingURL=([^\s]+)/);
              if (!match || !match[1]) continue;

              let mapUrl = match[1].trim();
              if (mapUrl.startsWith('data:')) {
                // Inline source map (base64)
                const b64 = mapUrl.replace(/^data:application\/json;base64,/, '');
                try {
                  const mapData = JSON.parse(atob(b64)) as SourceMapJson;
                  processMapData(mapData, scriptUrl);
                } catch {
                  // bad base64
                }
                continue;
              }

              // External .map file
              if (!mapUrl.startsWith('http')) {
                try {
                  mapUrl = new URL(mapUrl, scriptUrl).href;
                } catch {
                  continue;
                }
              }

              const mapResp = await fetch(mapUrl);
              const mapData = (await mapResp.json()) as SourceMapJson;
              processMapData(mapData, scriptUrl);
            } catch {
              // skip script
            }
          }

          return { total: files.length, files };
        },
        { includeContent, filterPath, maxFiles }
      );

      logger.info(`source_map_extract: recovered ${result.total} source files`);
      return asJsonResponse(result);
    } catch (error) {
      return asErrorResponse(error);
    }
  }

  async handleClearCollectedData(): Promise<ToolResponse> {
    try {
      await this.collector.clearAllData();
      this.scriptManager.clear();
      return asJsonResponse({
        success: true,
        message: 'All collected data cleared.',
        cleared: {
          fileCache: true,
          compressionCache: true,
          collectedUrls: true,
          scriptManager: true,
        },
      });
    } catch (error) {
      logger.error('Failed to clear collected data:', error);
      return asJsonResponse(serializeError(error));
    }
  }

  async handleGetCollectionStats(): Promise<ToolResponse> {
    try {
      const stats = await this.collector.getAllStats();
      return asJsonResponse({
        success: true,
        stats,
        summary: {
          totalCachedFiles: stats.cache.memoryEntries + stats.cache.diskEntries,
          totalCacheSize: `${(stats.cache.totalSize / 1024).toFixed(2)} KB`,
          compressionRatio: `${stats.compression.averageRatio.toFixed(1)}%`,
          cacheHitRate:
            stats.compression.cacheHits > 0
              ? `${(
                  (stats.compression.cacheHits /
                    (stats.compression.cacheHits + stats.compression.cacheMisses)) *
                  100
                ).toFixed(1)}%`
              : '0%',
          collectedUrls: stats.collector.collectedUrls,
        },
      });
    } catch (error) {
      logger.error('Failed to get collection stats:', error);
      return asJsonResponse(serializeError(error));
    }
  }
}
