import type { DomainManifest } from '../../registry/contracts.js';
import { toolLookup } from '../../registry/types.js';
import { bindByDepKey } from '../../registry/bind-helpers.js';
import { coreTools } from './definitions.js';
import { CoreAnalysisHandlers } from './index.js';
import type { MCPServerContext } from '../../MCPServer.context.js';
import { CodeCollector } from '../../../modules/collector/CodeCollector.js';
import { ScriptManager } from '../../../modules/debugger/ScriptManager.js';
import { LLMService } from '../../../services/LLMService.js';
import { Deobfuscator } from '../../../modules/deobfuscator/Deobfuscator.js';
import { AdvancedDeobfuscator } from '../../../modules/deobfuscator/AdvancedDeobfuscator.js';
import { ASTOptimizer } from '../../../modules/deobfuscator/ASTOptimizer.js';
import { ObfuscationDetector } from '../../../modules/detector/ObfuscationDetector.js';
import { CodeAnalyzer } from '../../../modules/analyzer/CodeAnalyzer.js';
import { CryptoDetector } from '../../../modules/crypto/CryptoDetector.js';
import { HookManager } from '../../../modules/hook/HookManager.js';

const DOMAIN = 'core' as const;
const DEP_KEY = 'coreAnalysisHandlers' as const;
type H = CoreAnalysisHandlers;
const t = toolLookup(coreTools);
const b = (invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);

function ensure(ctx: MCPServerContext): H {
  if (!ctx.collector) {
    ctx.collector = new CodeCollector(ctx.config.puppeteer);
    void ctx.registerCaches();
  }
  if (!ctx.scriptManager) {
    ctx.scriptManager = new ScriptManager(ctx.collector);
  }
  if (!ctx.llm) {
    ctx.llm = new LLMService(ctx.config.llm);
  }
  if (!ctx.deobfuscator) ctx.deobfuscator = new Deobfuscator(ctx.llm);
  if (!ctx.advancedDeobfuscator) ctx.advancedDeobfuscator = new AdvancedDeobfuscator(ctx.llm);
  if (!ctx.astOptimizer) ctx.astOptimizer = new ASTOptimizer();
  if (!ctx.obfuscationDetector) ctx.obfuscationDetector = new ObfuscationDetector();
  if (!ctx.analyzer) ctx.analyzer = new CodeAnalyzer(ctx.llm);
  if (!ctx.cryptoDetector) ctx.cryptoDetector = new CryptoDetector(ctx.llm);
  if (!ctx.hookManager) ctx.hookManager = new HookManager();

  if (!ctx.coreAnalysisHandlers) {
    ctx.coreAnalysisHandlers = new CoreAnalysisHandlers({
      collector: ctx.collector,
      scriptManager: ctx.scriptManager,
      deobfuscator: ctx.deobfuscator,
      advancedDeobfuscator: ctx.advancedDeobfuscator,
      astOptimizer: ctx.astOptimizer,
      obfuscationDetector: ctx.obfuscationDetector,
      analyzer: ctx.analyzer,
      cryptoDetector: ctx.cryptoDetector,
      hookManager: ctx.hookManager,
    });
  }
  return ctx.coreAnalysisHandlers;
}

const manifest: DomainManifest<typeof DEP_KEY, H, typeof DOMAIN> = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['workflow', 'full', 'reverse'],
  ensure,
  registrations: [
    { tool: t('collect_code'), domain: DOMAIN, bind: b((h, a) => h.handleCollectCode(a)) },
    { tool: t('search_in_scripts'), domain: DOMAIN, bind: b((h, a) => h.handleSearchInScripts(a)) },
    { tool: t('extract_function_tree'), domain: DOMAIN, bind: b((h, a) => h.handleExtractFunctionTree(a)) },
    { tool: t('deobfuscate'), domain: DOMAIN, bind: b((h, a) => h.handleDeobfuscate(a)) },
    { tool: t('understand_code'), domain: DOMAIN, bind: b((h, a) => h.handleUnderstandCode(a)) },
    { tool: t('detect_crypto'), domain: DOMAIN, bind: b((h, a) => h.handleDetectCrypto(a)) },
    { tool: t('manage_hooks'), domain: DOMAIN, bind: b((h, a) => h.handleManageHooks(a)) },
    { tool: t('detect_obfuscation'), domain: DOMAIN, bind: b((h, a) => h.handleDetectObfuscation(a)) },
    { tool: t('advanced_deobfuscate'), domain: DOMAIN, bind: b((h, a) => h.handleAdvancedDeobfuscate(a)) },
    { tool: t('clear_collected_data'), domain: DOMAIN, bind: b((h) => h.handleClearCollectedData()) },
    { tool: t('get_collection_stats'), domain: DOMAIN, bind: b((h) => h.handleGetCollectionStats()) },
    { tool: t('webpack_enumerate'), domain: DOMAIN, bind: b((h, a) => h.handleWebpackEnumerate(a)) },
    { tool: t('source_map_extract'), domain: DOMAIN, bind: b((h, a) => h.handleSourceMapExtract(a)) },
  ],
};

export default manifest;
