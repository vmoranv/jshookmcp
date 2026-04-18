import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, toolLookup } from '@server/domains/shared/registry';
import { transformTools } from '@server/domains/transform/definitions';
import { TransformToolHandlers } from '@server/domains/transform/index';
import { CodeCollector } from '@server/domains/shared/modules';

const DOMAIN = 'transform' as const;
const DEP_KEY = 'transformHandlers' as const;
type H = TransformToolHandlers;
const t = toolLookup(transformTools);
const b = (invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);

function ensure(ctx: MCPServerContext): H {
  if (!ctx.collector) {
    ctx.collector = new CodeCollector(ctx.config.puppeteer);
    void ctx.registerCaches();
  }
  if (!ctx.transformHandlers) ctx.transformHandlers = new TransformToolHandlers(ctx.collector);
  return ctx.transformHandlers;
}

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['full'],
  ensure,
  registrations: [
    {
      tool: t('ast_transform_preview'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleAstTransformPreview(a)),
    },
    {
      tool: t('ast_transform_chain'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleAstTransformChain(a)),
    },
    {
      tool: t('ast_transform_apply'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleAstTransformApply(a)),
    },
    {
      tool: t('crypto_extract_standalone'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleCryptoExtractStandalone(a)),
    },
    {
      tool: t('crypto_test_harness'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleCryptoTestHarness(a)),
    },
    { tool: t('crypto_compare'), domain: DOMAIN, bind: b((h, a) => h.handleCryptoCompare(a)) },
  ],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
