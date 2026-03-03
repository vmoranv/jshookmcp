import type { DomainManifest } from '../../registry/contracts.js';
import { toolLookup } from '../../registry/types.js';
import { bindByDepKey } from '../../registry/bind-helpers.js';
import { nativeBridgeTools } from './definitions.js';
import { NativeBridgeHandlers } from './index.js';
import type { MCPServerContext } from '../../MCPServer.context.js';

const DOMAIN = 'native-bridge' as const;
const DEP_KEY = 'nativeBridgeHandlers' as const;
type H = NativeBridgeHandlers;
const t = toolLookup(nativeBridgeTools);
const b = (invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);

function ensure(ctx: MCPServerContext): H {
  const ghidraEndpoint = process.env.GHIDRA_BRIDGE_URL ?? 'http://127.0.0.1:18080';
  const idaEndpoint = process.env.IDA_BRIDGE_URL ?? 'http://127.0.0.1:18081';

  if (!(ctx as unknown as Record<string, unknown>).nativeBridgeHandlers) {
    (ctx as unknown as Record<string, unknown>).nativeBridgeHandlers = new NativeBridgeHandlers(
      ghidraEndpoint,
      idaEndpoint,
    );
  }
  return (ctx as unknown as Record<string, unknown>).nativeBridgeHandlers as H;
}

const manifest: DomainManifest<typeof DEP_KEY, H, typeof DOMAIN> = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['full', 'reverse'],
  ensure,
  registrations: [
    { tool: t('native_bridge_status'), domain: DOMAIN, bind: b((h, a) => h.handleNativeBridgeStatus(a)) },
    { tool: t('ghidra_bridge'), domain: DOMAIN, bind: b((h, a) => h.handleGhidraBridge(a)) },
    { tool: t('ida_bridge'), domain: DOMAIN, bind: b((h, a) => h.handleIdaBridge(a)) },
    { tool: t('native_symbol_sync'), domain: DOMAIN, bind: b((h, a) => h.handleNativeSymbolSync(a)) },
  ],
};

export default manifest;
