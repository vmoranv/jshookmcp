import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { defineMethodRegistrations, toolLookup } from '@server/domains/shared/registry';
import { jadxSearchTools } from '@server/domains/jadx-search/definitions';
import type { JadxSearchHandlers } from '@server/domains/jadx-search/index';

const DOMAIN = 'jadx-search' as const;
const DEP_KEY = 'jadxSearchHandlers' as const;
type H = JadxSearchHandlers;
const t = toolLookup(jadxSearchTools);
const registrations = defineMethodRegistrations<H, (typeof jadxSearchTools)[number]['name']>({
  domain: DOMAIN,
  depKey: DEP_KEY,
  lookup: t,
  entries: [{ tool: 'jadx_search_code', method: 'handleJadxSearchCode' }],
});

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { JadxSearchHandlers } = await import('@server/domains/jadx-search/index');
  if (!ctx.jadxSearchHandlers) {
    ctx.jadxSearchHandlers = new JadxSearchHandlers();
  }
  return ctx.jadxSearchHandlers;
}

const manifest: DomainManifest<typeof DEP_KEY, H, typeof DOMAIN> = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['full'],
  ensure,
  registrations,
};

export default manifest;
