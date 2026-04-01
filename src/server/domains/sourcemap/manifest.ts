import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, toolLookup } from '@server/domains/shared/registry';
import { sourcemapTools } from '@server/domains/sourcemap/definitions';
import { SourcemapToolHandlers } from '@server/domains/sourcemap/index';
import { CodeCollector } from '@server/domains/shared/modules';

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

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['workflow', 'full'],
  ensure,
  registrations: [
    {
      tool: t('sourcemap_discover'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleSourcemapDiscover(a)),
    },
    {
      tool: t('sourcemap_fetch_and_parse'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleSourcemapFetchAndParse(a)),
    },
    {
      tool: t('sourcemap_reconstruct_tree'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleSourcemapReconstructTree(a)),
    },
    {
      tool: t('extension_list_installed'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleExtensionListInstalled(a)),
    },
    {
      tool: t('extension_execute_in_context'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleExtensionExecuteInContext(a)),
    },
  ],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
