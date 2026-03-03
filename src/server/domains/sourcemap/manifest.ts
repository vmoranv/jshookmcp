import type { DomainManifest } from '../../registry/contracts.js';
import { toolLookup } from '../../registry/types.js';
import { bindByDepKey } from '../../registry/bind-helpers.js';
import { sourcemapTools } from './definitions.js';
import { SourcemapToolHandlers } from './index.js';
import type { MCPServerContext } from '../../MCPServer.context.js';
import { CodeCollector } from '../../../modules/collector/CodeCollector.js';

const DOMAIN = 'sourcemap' as const;
const DEP_KEY = 'sourcemapHandlers' as const;
type H = SourcemapToolHandlers;
const t = toolLookup(sourcemapTools);
const b = (invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);

function ensure(ctx: MCPServerContext): H {
  if (!ctx.collector) {
    ctx.collector = new CodeCollector(ctx.config.puppeteer);
    void ctx.registerCaches();
  }
  if (!ctx.sourcemapHandlers) ctx.sourcemapHandlers = new SourcemapToolHandlers(ctx.collector);
  return ctx.sourcemapHandlers;
}

const manifest: DomainManifest<typeof DEP_KEY, H, typeof DOMAIN> = {
  kind: 'domain-manifest', version: 1,
  domain: DOMAIN, depKey: DEP_KEY,
  profiles: ['full', 'reverse'],
  ensure,
  registrations: [
    { tool: t('sourcemap_discover'), domain: DOMAIN, bind: b((h, a) => h.handleSourcemapDiscover(a)) },
    { tool: t('sourcemap_fetch_and_parse'), domain: DOMAIN, bind: b((h, a) => h.handleSourcemapFetchAndParse(a)) },
    { tool: t('sourcemap_reconstruct_tree'), domain: DOMAIN, bind: b((h, a) => h.handleSourcemapReconstructTree(a)) },
    { tool: t('extension_list_installed'), domain: DOMAIN, bind: b((h, a) => h.handleExtensionListInstalled(a)) },
    { tool: t('extension_execute_in_context'), domain: DOMAIN, bind: b((h, a) => h.handleExtensionExecuteInContext(a)) },
  ],
};

export default manifest;
