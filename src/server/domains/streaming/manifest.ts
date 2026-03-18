import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, ensureBrowserCore, toolLookup } from '@server/domains/shared/registry';
import { streamingTools } from '@server/domains/streaming/definitions';
import { StreamingToolHandlers } from '@server/domains/streaming/index';

const DOMAIN = 'streaming' as const;
const DEP_KEY = 'streamingHandlers' as const;
type H = StreamingToolHandlers;
const t = toolLookup(streamingTools);
const b = (invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);

function ensure(ctx: MCPServerContext): H {
  ensureBrowserCore(ctx);
  if (!ctx.streamingHandlers) ctx.streamingHandlers = new StreamingToolHandlers(ctx.collector!);
  return ctx.streamingHandlers;
}

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['workflow', 'full'],
  ensure,
  registrations: [
    { tool: t('ws_monitor_enable'), domain: DOMAIN, bind: b((h, a) => h.handleWsMonitorEnable(a)) },
    {
      tool: t('ws_monitor_disable'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleWsMonitorDisable(a)),
    },
    { tool: t('ws_get_frames'), domain: DOMAIN, bind: b((h, a) => h.handleWsGetFrames(a)) },
    {
      tool: t('ws_get_connections'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleWsGetConnections(a)),
    },
    {
      tool: t('sse_monitor_enable'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleSseMonitorEnable(a)),
    },
    { tool: t('sse_get_events'), domain: DOMAIN, bind: b((h, a) => h.handleSseGetEvents(a)) },
  ],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
