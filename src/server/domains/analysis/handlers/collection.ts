/**
 * Collection handlers: collect_code, search_in_scripts, extract_function_tree
 */

import {
  argBool,
  argEnum,
  argNumber,
  argString,
  argStringRequired,
} from '@server/domains/shared/parse-args';
import { asJsonResponse } from '@server/domains/shared/response';
import type { CodeCollector } from '@server/domains/shared/modules/collector';
import type { ScriptManager } from '@server/domains/shared/modules';
import type { ToolArgs, ToolResponse } from '@server/types';
import {
  ANALYSIS_MAX_SUMMARY_FILES,
  ANALYSIS_MAX_SAFE_COLLECTED_BYTES,
  ANALYSIS_MAX_SAFE_RESPONSE_BYTES,
} from '@src/constants';
import { logger } from '@utils/logger';
import { getToolRequestContext } from '@server/runtime/ToolRequestContext';

const SMART_MODES = new Set(['summary', 'priority', 'incremental', 'full'] as const);

interface CollectorHandlerDeps {
  collector: CodeCollector;
  scriptManager: ScriptManager;
}

export class CollectionHandlers {
  private readonly collector: CodeCollector;
  private readonly scriptManager: ScriptManager;

  constructor(deps: CollectorHandlerDeps) {
    this.collector = deps.collector;
    this.scriptManager = deps.scriptManager;
  }

  async handleCollectCode(args: ToolArgs): Promise<ToolResponse> {
    const returnSummaryOnly = argBool(args, 'returnSummaryOnly', false);
    let smartMode = argEnum(args, 'smartMode', SMART_MODES);
    const maxSummaryFiles = ANALYSIS_MAX_SUMMARY_FILES;

    const summarizeFiles = (
      files: Array<{
        url: string;
        type: string;
        size: number;
        content: string;
        metadata?: { truncated?: boolean };
      }>,
    ) =>
      files.slice(0, maxSummaryFiles).map((file) => ({
        url: file.url,
        type: file.type,
        size: file.size,
        sizeKB: (file.size / 1024).toFixed(2),
        truncated: file.metadata?.truncated || false,
        preview: `${file.content.substring(0, 200)}...`,
      }));

    const summarizeResult = (result: Awaited<ReturnType<CodeCollector['collect']>>) => {
      const rawEntries =
        Array.isArray(result.summaries) && result.summaries.length > 0
          ? result.summaries
          : summarizeFiles(
              result.files as Array<{
                url: string;
                type: string;
                size: number;
                content: string;
                metadata?: { truncated?: boolean };
              }>,
            );
      const entries = rawEntries.slice(0, maxSummaryFiles);
      const filesCount = Array.isArray(result.summaries)
        ? result.summaries.length
        : result.files.length;
      const totalSize =
        result.totalSize > 0
          ? result.totalSize
          : Array.isArray(result.summaries)
            ? result.summaries.reduce(
                (sum, entry) => sum + (typeof entry.size === 'number' ? entry.size : 0),
                0,
              )
            : result.files.reduce((sum, file) => sum + file.size, 0);

      return {
        totalSize,
        totalSizeKB: (totalSize / 1024).toFixed(2),
        filesCount,
        summarizedFiles: entries.length,
        omittedFiles: Math.max(0, filesCount - entries.length),
        collectTime: result.collectTime,
        summary: entries,
      };
    };

    // Default to 'summary' mode to prevent full-collection payload bloat
    if (!smartMode) {
      smartMode = returnSummaryOnly ? 'summary' : 'summary';
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
      const summaryResult = summarizeResult(result);
      return asJsonResponse({
        mode: 'summary',
        ...summaryResult,
        hint: 'Use get_script_source for specific files.',
      });
    }

    const maxSafeCollectedSize = ANALYSIS_MAX_SAFE_COLLECTED_BYTES;
    const maxSafeResponseSize = ANALYSIS_MAX_SAFE_RESPONSE_BYTES;
    const estimatedResponseSize = Buffer.byteLength(JSON.stringify(result), 'utf8');

    if (result.totalSize > maxSafeCollectedSize || estimatedResponseSize > maxSafeResponseSize) {
      logger.warn(
        `Collected code is too large (collected=${(result.totalSize / 1024).toFixed(2)}KB, response=` +
          `${(estimatedResponseSize / 1024).toFixed(2)}KB), returning summary mode.`,
      );

      const summaryResult = summarizeResult(result);
      return asJsonResponse({
        warning: 'Code size exceeds safe response threshold; summary returned.',
        ...summaryResult,
        estimatedResponseSize,
        estimatedResponseSizeKB: (estimatedResponseSize / 1024).toFixed(2),
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
      signal: getToolRequestContext()?.signal,
      timeoutMs: argNumber(args, 'timeoutMs', 30_000),
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
}
