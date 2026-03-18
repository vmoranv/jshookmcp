import { logger } from '@utils/logger';
import type { ToolArgs, ToolResponse } from '@server/types';
import { asJsonResponse, asTextResponse, serializeError } from '@server/domains/shared/response';
import {
  argString,
  argBool,
  argNumber,
  argStringRequired,
  argObject,
  argEnum,
} from '@server/domains/shared/parse-args';

const SMART_MODES = new Set(['summary', 'priority', 'incremental', 'full'] as const);
const FOCUS_MODES = new Set(['structure', 'business', 'security', 'all'] as const);
const HOOK_TYPES = new Set([
  'function',
  'xhr',
  'fetch',
  'websocket',
  'localstorage',
  'cookie',
] as const);
const HOOK_ACTIONS = new Set(['log', 'block', 'modify'] as const);
import { CodeCollector } from '@server/domains/shared/modules';
import { ScriptManager } from '@server/domains/shared/modules';
import { Deobfuscator } from '@server/domains/shared/modules';
import { AdvancedDeobfuscator } from '@server/domains/shared/modules';
import { ObfuscationDetector } from '@server/domains/shared/modules';
import { CodeAnalyzer } from '@server/domains/shared/modules';
import { CryptoDetector } from '@server/domains/shared/modules';
import { HookManager } from '@server/domains/shared/modules';
import {
  runSourceMapExtract,
  runWebpackEnumerate,
} from '@server/domains/analysis/handlers.web-tools';
import { runWebcrack } from '@modules/deobfuscator/webcrack';
import type { DeobfuscateMappingRule } from '@internal-types/deobfuscator';

interface CoreAnalysisHandlerDeps {
  collector: CodeCollector;
  scriptManager: ScriptManager;
  deobfuscator: Deobfuscator;
  advancedDeobfuscator: AdvancedDeobfuscator;
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
  private readonly obfuscationDetector: ObfuscationDetector;
  private readonly analyzer: CodeAnalyzer;
  private readonly cryptoDetector: CryptoDetector;
  private readonly hookManager: HookManager;

  constructor(deps: CoreAnalysisHandlerDeps) {
    this.collector = deps.collector;
    this.scriptManager = deps.scriptManager;
    this.deobfuscator = deps.deobfuscator;
    this.advancedDeobfuscator = deps.advancedDeobfuscator;
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

  private extractWebcrackArgs(args: ToolArgs) {
    const extracted: Record<string, unknown> = {};

    if (typeof args.unpack === 'boolean') extracted.unpack = args.unpack;
    if (typeof args.unminify === 'boolean') extracted.unminify = args.unminify;
    if (typeof args.jsx === 'boolean') extracted.jsx = args.jsx;
    if (typeof args.mangle === 'boolean') extracted.mangle = args.mangle;
    if (typeof args.outputDir === 'string' && args.outputDir.trim().length > 0) {
      extracted.outputDir = args.outputDir;
    }
    if (typeof args.forceOutput === 'boolean') extracted.forceOutput = args.forceOutput;
    if (typeof args.includeModuleCode === 'boolean')
      extracted.includeModuleCode = args.includeModuleCode;
    if (typeof args.maxBundleModules === 'number')
      extracted.maxBundleModules = args.maxBundleModules;
    if (Array.isArray(args.mappings)) {
      extracted.mappings = (args.mappings as unknown[]).filter(
        (item): item is DeobfuscateMappingRule =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as { path?: unknown }).path === 'string' &&
          typeof (item as { pattern?: unknown }).pattern === 'string'
      );
    }

    return extracted;
  }

  async handleCollectCode(args: ToolArgs): Promise<ToolResponse> {
    const returnSummaryOnly = argBool(args, 'returnSummaryOnly', false);
    let smartMode = argEnum(args, 'smartMode', SMART_MODES);
    const maxSummaryFiles = 40;

    const summarizeFiles = (
      files: Array<{
        url: string;
        type: string;
        size: number;
        content: string;
        metadata?: { truncated?: boolean };
      }>
    ) =>
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
      url: argStringRequired(args, 'url'),
      includeInline: argBool(args, 'includeInline'),
      includeExternal: argBool(args, 'includeExternal'),
      includeDynamic: argBool(args, 'includeDynamic'),
      smartMode,
      compress: argBool(args, 'compress'),
      maxTotalSize: argNumber(args, 'maxTotalSize'),
      maxFileSize: args.maxFileSize ? argNumber(args, 'maxFileSize', 0) * 1024 : undefined,
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

    const keyword = argString(args, 'keyword');
    if (!keyword) {
      return asJsonResponse({ success: false, error: 'keyword is required' });
    }

    const maxMatches = argNumber(args, 'maxMatches', 100);
    const returnSummary = argBool(args, 'returnSummary', false);
    const maxContextSize = argNumber(args, 'maxContextSize', 50000);

    const result = await this.scriptManager.searchInScripts(keyword, {
      isRegex: argBool(args, 'isRegex'),
      caseSensitive: argBool(args, 'caseSensitive'),
      contextLines: argNumber(args, 'contextLines'),
      maxMatches,
    });
    type ScriptSearchMatch = {
      scriptId?: string | number;
      url?: string;
      line?: number;
      context?: string;
    };

    const resultSize = JSON.stringify(result).length;
    const shouldSummarize = returnSummary || resultSize > maxContextSize;

    if (shouldSummarize) {
      const matches = (result.matches ?? []) as ScriptSearchMatch[];
      return asJsonResponse({
        success: true,
        keyword: args.keyword,
        totalMatches: matches.length,
        resultSize,
        resultSizeKB: (resultSize / 1024).toFixed(2),
        truncated: resultSize > maxContextSize,
        reason:
          resultSize > maxContextSize
            ? `Result too large (${(resultSize / 1024).toFixed(2)}KB > ${(maxContextSize / 1024).toFixed(2)}KB)`
            : 'Summary mode enabled',
        matchesSummary: matches.slice(0, 10).map((match) => ({
          scriptId: match.scriptId,
          url: match.url,
          line: match.line,
          preview: `${(match.context ?? '').substring(0, 100)}...`,
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
    const scriptId = argString(args, 'scriptId');
    const functionName = argString(args, 'functionName');

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
    const scriptExists = scripts.some((s) => String(s.scriptId) === String(scriptId));

    if (!scriptExists) {
      const availableScripts = scripts.slice(0, 10).map((s) => ({
        scriptId: s.scriptId,
        url: s.url?.substring(0, 80),
      }));

      return asJsonResponse({
        success: false,
        error: `Script not found: ${scriptId}`,
        hint: 'The specified scriptId does not exist. Use get_all_scripts() to list available scripts.',
        availableScripts:
          availableScripts.length > 0
            ? availableScripts
            : 'No scripts loaded. Navigate to a page first.',
        totalScripts: scripts.length,
      });
    }

    try {
      const result = await this.scriptManager.extractFunctionTree(scriptId, functionName, {
        maxDepth: argNumber(args, 'maxDepth'),
        maxSize: argNumber(args, 'maxSize'),
        includeComments: argBool(args, 'includeComments'),
      });
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
      llm: argString(args, 'llm') as 'gpt-4' | 'claude' | undefined,
      aggressive: argBool(args, 'aggressive'),
      ...this.extractWebcrackArgs(args),
    });

    // Ensure failures always carry an error field for LLM clarity
    if (
      result &&
      typeof result === 'object' &&
      'success' in result &&
      result.success === false &&
      !('error' in result)
    ) {
      return asJsonResponse({
        ...result,
        error: (result as Record<string, unknown>).reason || 'deobfuscation failed',
      });
    }

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
      context: argObject(args, 'context'),
      focus: argEnum(args, 'focus', FOCUS_MODES, 'all'),
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
    const action = argStringRequired(args, 'action');

    switch (action) {
      case 'create': {
        const result = await this.hookManager.createHook({
          target: argStringRequired(args, 'target'),
          type: argEnum(args, 'type', HOOK_TYPES) ?? 'function',
          action: argEnum(args, 'hookAction', HOOK_ACTIONS, 'log'),
          customCode: argString(args, 'customCode'),
        });
        return asJsonResponse(result);
      }
      case 'list':
        return asJsonResponse({ hooks: this.hookManager.getAllHooks() });
      case 'records':
        return asJsonResponse({
          records: this.hookManager.getHookRecords(argStringRequired(args, 'hookId')),
        });
      case 'clear':
        this.hookManager.clearHookRecords(argString(args, 'hookId'));
        return asJsonResponse({ success: true, message: 'Hook records cleared' });
      default:
        return asJsonResponse({
          success: false,
          message: `Unknown hook action: ${action}. Valid actions: create, list, records, clear`,
        });
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

    const generateReport = argBool(args, 'generateReport', true);
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

    const result = await this.advancedDeobfuscator.deobfuscate({
      code,
      ...this.extractWebcrackArgs(args),
      ...(typeof args.detectOnly === 'boolean' ? { detectOnly: args.detectOnly } : {}),
      ...(typeof args.aggressiveVM === 'boolean' ? { aggressiveVM: args.aggressiveVM } : {}),
      ...(typeof args.useASTOptimization === 'boolean'
        ? { useASTOptimization: args.useASTOptimization }
        : {}),
      ...(typeof args.timeout === 'number' ? { timeout: args.timeout } : {}),
    });

    return asJsonResponse(result);
  }

  async handleWebcrackUnpack(args: ToolArgs): Promise<ToolResponse> {
    const code = this.requireCodeArg(args, 'webcrack_unpack');
    if (!code) {
      return asJsonResponse({
        success: false,
        error: 'code is required and must be a non-empty string',
      });
    }

    const result = await runWebcrack(code, {
      unpack: argBool(args, 'unpack', true),
      unminify: argBool(args, 'unminify', true),
      jsx: argBool(args, 'jsx', true),
      mangle: argBool(args, 'mangle', false),
      ...this.extractWebcrackArgs(args),
    });

    if (!result.applied) {
      return asJsonResponse({
        success: false,
        error: result.reason || 'webcrack execution failed',
        optionsUsed: result.optionsUsed,
        engine: 'webcrack',
      });
    }

    return asJsonResponse({
      success: true,
      code: result.code,
      bundle: result.bundle,
      savedTo: result.savedTo,
      savedArtifacts: result.savedArtifacts,
      optionsUsed: result.optionsUsed,
      engine: 'webcrack',
    });
  }

  async handleWebpackEnumerate(args: ToolArgs): Promise<ToolResponse> {
    return runWebpackEnumerate(this.collector, args);
  }

  async handleSourceMapExtract(args: ToolArgs): Promise<ToolResponse> {
    return runSourceMapExtract(this.collector, args);
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
