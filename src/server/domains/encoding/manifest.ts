import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, toolLookup } from '@server/domains/shared/registry';
import { encodingTools } from '@server/domains/encoding/definitions';
import { EncodingToolHandlers } from '@server/domains/encoding/index';
import { CodeCollector } from '@server/domains/shared/modules';

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

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['workflow', 'full'],
  ensure,
  registrations: [
    {
      tool: t('binary_detect_format'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleBinaryDetectFormat(a)),
    },
    { tool: t('binary_decode'), domain: DOMAIN, bind: b((h, a) => h.handleBinaryDecode(a)) },
    { tool: t('binary_encode'), domain: DOMAIN, bind: b((h, a) => h.handleBinaryEncode(a)) },
    {
      tool: t('binary_entropy_analysis'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleBinaryEntropyAnalysis(a)),
    },
    {
      tool: t('protobuf_decode_raw'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleProtobufDecodeRaw(a)),
    },
  ],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
