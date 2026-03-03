import type { DomainManifest } from '../../registry/contracts.js';
import { toolLookup } from '../../registry/types.js';
import { bindByDepKey } from '../../registry/bind-helpers.js';
import { streamingTools } from './definitions.js';
import { StreamingToolHandlers } from './index.js';
import type { MCPServerContext } from '../../MCPServer.context.js';
import { CodeCollector } from '../../../modules/collector/CodeCollector.js';

const DOMAIN = 'streaming' as const;
const DEP_KEY = 'streamingHandlers' as const;
type H = StreamingToolHandlers;
const t = toolLookup(streamingTools);
const b = (invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);

function ensure(ctx: MCPServerContext): H {
  if (!ctx.collector) {
    ctx.collector = new CodeCollector(ctx.config.puppeteer);
    void ctx.registerCaches();
  }
  if (!ctx.streamingHandlers) ctx.streamingHandlers = new StreamingToolHandlers(ctx.collector);
  return ctx.streamingHandlers;
}

const manifest: DomainManifest<typeof DEP_KEY, H, typeof DOMAIN> = {
  kind: 'domain-manifest', version: 1,
  domain: DOMAIN, depKey: DEP_KEY,
  profiles: ['workflow', 'full', 'reverse'],
  ensure,
  registrations: [
    { tool: t('ws_monitor_enable'), domain: DOMAIN, bind: b((h, a) => h.handleWsMonitorEnable(a)) },
    { tool: t('ws_monitor_disable'), domain: DOMAIN, bind: b((h, a) => h.handleWsMonitorDisable(a)) },
    { tool: t('ws_get_frames'), domain: DOMAIN, bind: b((h, a) => h.handleWsGetFrames(a)) },
    { tool: t('ws_get_connections'), domain: DOMAIN, bind: b((h, a) => h.handleWsGetConnections(a)) },
    { tool: t('sse_monitor_enable'), domain: DOMAIN, bind: b((h, a) => h.handleSseMonitorEnable(a)) },
    { tool: t('sse_get_events'), domain: DOMAIN, bind: b((h, a) => h.handleSseGetEvents(a)) },
  ],
};

export default manifest;
