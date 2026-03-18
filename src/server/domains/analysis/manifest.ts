import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, ensureBrowserCore, toolLookup } from '@server/domains/shared/registry';
import { coreTools } from '@server/domains/analysis/definitions';
import { CoreAnalysisHandlers } from '@server/domains/analysis/index';
import { Deobfuscator } from '@server/domains/shared/modules';
import { AdvancedDeobfuscator } from '@server/domains/shared/modules';
import { ObfuscationDetector } from '@server/domains/shared/modules';
import { CodeAnalyzer } from '@server/domains/shared/modules';
import { CryptoDetector } from '@server/domains/shared/modules';
import { HookManager } from '@server/domains/shared/modules';

const DOMAIN = 'core' as const;
const DEP_KEY = 'coreAnalysisHandlers' as const;
type H = CoreAnalysisHandlers;
const t = toolLookup(coreTools);
const b = (invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);

function ensure(ctx: MCPServerContext): H {
  ensureBrowserCore(ctx);

  if (!ctx.deobfuscator) ctx.deobfuscator = new Deobfuscator(ctx.llm!);
  if (!ctx.advancedDeobfuscator) ctx.advancedDeobfuscator = new AdvancedDeobfuscator();
  if (!ctx.obfuscationDetector) ctx.obfuscationDetector = new ObfuscationDetector();
  if (!ctx.analyzer) ctx.analyzer = new CodeAnalyzer(ctx.llm!);
  if (!ctx.cryptoDetector) ctx.cryptoDetector = new CryptoDetector(ctx.llm!);
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
  ],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
