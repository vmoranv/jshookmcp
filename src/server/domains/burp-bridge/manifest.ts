import type { DomainManifest } from '../../registry/contracts.js';
import { toolLookup } from '../../registry/types.js';
import { bindByDepKey } from '../../registry/bind-helpers.js';
import { burpBridgeTools } from './definitions.js';
import { BurpBridgeHandlers } from './index.js';
import type { MCPServerContext } from '../../MCPServer.context.js';

const DOMAIN = 'burp-bridge' as const;
const DEP_KEY = 'burpBridgeHandlers' as const;
type H = BurpBridgeHandlers;
const t = toolLookup(burpBridgeTools);
const b = (invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);

function ensure(ctx: MCPServerContext): H {
  // Read endpoint from config or env
  const endpoint =
    process.env.BURP_ADAPTER_URL ??
    'http://127.0.0.1:18443';

  if (!(ctx as unknown as Record<string, unknown>).burpBridgeHandlers) {
    (ctx as unknown as Record<string, unknown>).burpBridgeHandlers = new BurpBridgeHandlers(endpoint);
  }
  return (ctx as unknown as Record<string, unknown>).burpBridgeHandlers as H;
}

const manifest: DomainManifest<typeof DEP_KEY, H, typeof DOMAIN> = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['workflow', 'full', 'reverse'],
  ensure,
  registrations: [
    { tool: t('burp_proxy_status'), domain: DOMAIN, bind: b((h, a) => h.handleBurpProxyStatus(a)) },
    { tool: t('intercept_and_replay_to_burp'), domain: DOMAIN, bind: b((h, a) => h.handleInterceptAndReplayToBurp(a)) },
    { tool: t('import_har_from_burp'), domain: DOMAIN, bind: b((h, a) => h.handleImportHarFromBurp(a)) },
    { tool: t('diff_har'), domain: DOMAIN, bind: b((h, a) => h.handleDiffHar(a)) },
    { tool: t('burp_send_to_repeater'), domain: DOMAIN, bind: b((h, a) => h.handleBurpSendToRepeater(a)) },
  ],
};

export default manifest;
