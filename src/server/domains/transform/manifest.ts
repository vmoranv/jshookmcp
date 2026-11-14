import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { defineMethodRegistrations, toolLookup } from '@server/domains/shared/registry';
import { transformTools } from '@server/domains/transform/definitions';
import type { TransformToolHandlers } from '@server/domains/transform/index';

const DOMAIN = 'transform' as const;
const DEP_KEY = 'transformHandlers' as const;
type H = TransformToolHandlers;
const t = toolLookup(transformTools);
const registrations = defineMethodRegistrations<H, (typeof transformTools)[number]['name']>({
  domain: DOMAIN,
  depKey: DEP_KEY,
  lookup: t,
  entries: [
    { tool: 'ast_transform_preview', method: 'handleAstTransformPreviewTool' },
    { tool: 'ast_transform_chain', method: 'handleAstTransformChainTool' },
    { tool: 'ast_transform_apply', method: 'handleAstTransformApplyTool' },
    { tool: 'ast_transform_beautify', method: 'handleAstTransformBeautifyTool' },
    { tool: 'crypto_extract_standalone', method: 'handleCryptoExtractStandaloneTool' },
    { tool: 'crypto_test_harness', method: 'handleCryptoTestHarnessTool' },
    { tool: 'crypto_compare', method: 'handleCryptoCompareTool' },
    { tool: 'transform_workbench', method: 'handleTransformWorkbenchTool' },
  ],
});

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { CodeCollector } = await import('@server/domains/shared/modules/collector');
  const { TransformToolHandlers } = await import('@server/domains/transform/index');
  if (!ctx.collector) {
    ctx.collector = new CodeCollector(ctx.config.puppeteer);
    void ctx.registerCaches();
  }
  if (!ctx.transformHandlers) ctx.transformHandlers = new TransformToolHandlers(ctx.collector);
  return ctx.transformHandlers;
}

// ── Document-expansion keywords (search retrieval layer) ──
// Query phrases bridging user vocabulary to this tool's vocabulary without
// duplicating name/description tokens. Folded into generated-tool-catalog by
// scripts/generate-domains-index.mjs; weighted SEARCH_SCENE_KEYWORD_WEIGHT.
const SCENE_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  ast_transform_apply: ['apply code transformation', 'run ast rewrite', 'apply an ast transform'],
  ast_transform_beautify: [
    'pretty print javascript',
    'format minified code',
    'pretty print the source code',
  ],
  ast_transform_chain: [
    'run multiple rewrites in sequence',
    'compose transformations',
    'compose several transforms together',
    'pipeline several rewrites sequentially',
  ],
  ast_transform_preview: [
    'diff before and after rewrite',
    'preview transformation result',
    'preview a transform without applying it',
  ],
  crypto_compare: [
    'side by side crypto output',
    'diff two cipher outputs',
    'compare the encrypted outputs',
  ],
  crypto_extract_standalone: [
    'pull crypto routine out of bundle',
    'isolate encryption function',
    'extract the crypto functions',
  ],
  crypto_test_harness: [
    'verify crypto implementation',
    'run cipher test vectors',
    'run the crypto test harness',
  ],
  transform_workbench: [
    'interactive code rewrite workspace',
    'transform pipeline playground',
    'transform workbench',
  ],
};

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['full'],
  ensure,
  registrations,

  // Document-expansion keywords for the retrieval layer (SCENE_KEYWORDS above).
  sceneKeywords: SCENE_KEYWORDS,
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
