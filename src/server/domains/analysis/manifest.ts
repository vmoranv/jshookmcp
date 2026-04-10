import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { ensureBrowserCore, toolLookup } from '@server/domains/shared/registry';
import { coreTools } from '@server/domains/analysis/definitions';
import { CoreAnalysisHandlers } from '@server/domains/analysis/index';
import { Deobfuscator } from '@server/domains/shared/modules';
import { AdvancedDeobfuscator } from '@server/domains/shared/modules';
import { ObfuscationDetector } from '@server/domains/shared/modules';
import { CodeAnalyzer } from '@server/domains/shared/modules';
import { CryptoDetector } from '@server/domains/shared/modules';
import { HookManager } from '@server/domains/shared/modules';
import { LLMDeobfuscator } from '@modules/deobfuscator/LLMDeobfuscator';

const DOMAIN = 'core' as const;
const DEP_KEY = 'coreAnalysisHandlers' as const;
type H = CoreAnalysisHandlers;
const t = toolLookup(coreTools);

let globalContext: MCPServerContext | null = null;

import { createProgressDebouncer } from '@server/EventBus';

/**
 * Analysis-domain bind helper that threads `_meta.progressToken` into
 * a throttled `onProgress` callback — same pattern as memory/manifest.ts.
 */
function bindWithProgress(invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>) {
  return (deps: Record<string, unknown>) => {
    const handler = deps[DEP_KEY] as H;
    return (args: Record<string, unknown>) => {
      const _meta = args._meta as { progressToken?: string | number } | undefined;
      let onProgress: ((progress: number, total?: number) => void) | undefined;

      if (_meta?.progressToken !== undefined && globalContext) {
        onProgress = createProgressDebouncer(globalContext.eventBus, _meta.progressToken);
      }
      return invoke(handler, { ...args, onProgress });
    };
  };
}

const b = bindWithProgress;

function ensure(ctx: MCPServerContext): H {
  globalContext = ctx;
  ensureBrowserCore(ctx);

  if (!ctx.deobfuscator) ctx.deobfuscator = new Deobfuscator();
  if (!ctx.advancedDeobfuscator) ctx.advancedDeobfuscator = new AdvancedDeobfuscator();
  if (!ctx.obfuscationDetector) ctx.obfuscationDetector = new ObfuscationDetector();
  if (!ctx.analyzer) ctx.analyzer = new CodeAnalyzer();
  if (!ctx.cryptoDetector) ctx.cryptoDetector = new CryptoDetector();
  if (!ctx.hookManager) ctx.hookManager = new HookManager();

  if (!ctx.coreAnalysisHandlers) {
    ctx.coreAnalysisHandlers = new CoreAnalysisHandlers({
      collector: ctx.collector!,
      scriptManager: ctx.scriptManager!,
      deobfuscator: ctx.deobfuscator,
      advancedDeobfuscator: ctx.advancedDeobfuscator,
      obfuscationDetector: ctx.obfuscationDetector,
      analyzer: ctx.analyzer,
      cryptoDetector: ctx.cryptoDetector,
      hookManager: ctx.hookManager,
    });
  }
  return ctx.coreAnalysisHandlers;
}

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['workflow', 'full'],
  ensure,

  workflowRule: {
    patterns: [
      /(deobfuscate|deobfusc|beautify|analyze).*(javascript|js|script|code)/i,
      /(反混淆|美化|分析).*(javascript|js|脚本|代码)/i,
    ],
    priority: 85,
    tools: ['deobfuscate', 'advanced_deobfuscate', 'extract_function_tree', 'llm_suggest_names'],
    hint: 'JavaScript analysis workflow: collect -> deobfuscate -> inspect function tree | LLM-powered naming',
  },

  prerequisites: {
    collect_code: [
      { condition: 'Browser must be launched', fix: 'Call browser_launch or browser_attach first' },
    ],
  },

  registrations: [
    { tool: t('collect_code'), domain: DOMAIN, bind: b((h, a) => h.handleCollectCode(a)) },
    { tool: t('search_in_scripts'), domain: DOMAIN, bind: b((h, a) => h.handleSearchInScripts(a)) },
    {
      tool: t('extract_function_tree'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleExtractFunctionTree(a)),
    },
    { tool: t('deobfuscate'), domain: DOMAIN, bind: b((h, a) => h.handleDeobfuscate(a)) },
    { tool: t('understand_code'), domain: DOMAIN, bind: b((h, a) => h.handleUnderstandCode(a)) },
    { tool: t('detect_crypto'), domain: DOMAIN, bind: b((h, a) => h.handleDetectCrypto(a)) },
    { tool: t('manage_hooks'), domain: DOMAIN, bind: b((h, a) => h.handleManageHooks(a)) },
    {
      tool: t('detect_obfuscation'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleDetectObfuscation(a)),
    },
    {
      tool: t('advanced_deobfuscate'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleAdvancedDeobfuscate(a)),
    },
    { tool: t('webcrack_unpack'), domain: DOMAIN, bind: b((h, a) => h.handleWebcrackUnpack(a)) },
    {
      tool: t('clear_collected_data'),
      domain: DOMAIN,
      bind: b((h) => h.handleClearCollectedData()),
    },
    {
      tool: t('get_collection_stats'),
      domain: DOMAIN,
      bind: b((h) => h.handleGetCollectionStats()),
    },
    {
      tool: t('webpack_enumerate'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleWebpackEnumerate(a)),
    },
    {
      tool: t('source_map_extract'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleSourceMapExtract(a)),
    },
    {
      tool: t('llm_suggest_names'),
      domain: DOMAIN,
      bind: bindWithProgress(async (_h, args) => {
        if (!globalContext) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ success: false, error: 'Server context not initialized' }),
              },
            ],
          };
        }
        const deob = new LLMDeobfuscator(globalContext.samplingBridge);
        if (!deob.isAvailable()) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  success: false,
                  error: 'Sampling not supported by this client',
                  hint: 'The connected MCP client does not declare sampling capabilities. Try using Claude Desktop or another sampling-capable client.',
                }),
              },
            ],
          };
        }
        const code = typeof args.code === 'string' ? args.code : '';
        const identifiers = Array.isArray(args.identifiers)
          ? (args.identifiers as unknown[]).filter((id): id is string => typeof id === 'string')
          : [];
        const suggestions = await deob.suggestVariableNames(code, identifiers);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                suggestions: suggestions ?? [],
                samplingUsed: true,
              }),
            },
          ],
        };
      }),
    },
  ],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
