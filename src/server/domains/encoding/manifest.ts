import type { DomainManifest } from '../../registry/contracts.js';
import { toolLookup } from '../../registry/types.js';
import { bindByDepKey } from '../../registry/bind-helpers.js';
import { encodingTools } from './definitions.js';
import { EncodingToolHandlers } from './index.js';
import type { MCPServerContext } from '../../MCPServer.context.js';
import { CodeCollector } from '../../../modules/collector/CodeCollector.js';

const DOMAIN = 'encoding' as const;
const DEP_KEY = 'encodingHandlers' as const;
type H = EncodingToolHandlers;
const t = toolLookup(encodingTools);
const b = (invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);

function ensure(ctx: MCPServerContext): H {
  if (!ctx.collector) {
    ctx.collector = new CodeCollector(ctx.config.puppeteer);
    void ctx.registerCaches();
  }
  if (!ctx.encodingHandlers) ctx.encodingHandlers = new EncodingToolHandlers(ctx.collector);
  return ctx.encodingHandlers;
}

const manifest: DomainManifest<typeof DEP_KEY, H, typeof DOMAIN> = {
  kind: 'domain-manifest', version: 1,
  domain: DOMAIN, depKey: DEP_KEY,
  profiles: ['workflow', 'full', 'reverse'],
  ensure,
  registrations: [
    { tool: t('binary_detect_format'), domain: DOMAIN, bind: b((h, a) => h.handleBinaryDetectFormat(a)) },
    { tool: t('binary_decode'), domain: DOMAIN, bind: b((h, a) => h.handleBinaryDecode(a)) },
    { tool: t('binary_encode'), domain: DOMAIN, bind: b((h, a) => h.handleBinaryEncode(a)) },
    { tool: t('binary_entropy_analysis'), domain: DOMAIN, bind: b((h, a) => h.handleBinaryEntropyAnalysis(a)) },
    { tool: t('protobuf_decode_raw'), domain: DOMAIN, bind: b((h, a) => h.handleProtobufDecodeRaw(a)) },
  ],
};

export default manifest;
