import { TLSKeyLogExtractor } from '@modules/boringssl-inspector';
import { boringsslInspectorTools } from '@server/domains/boringssl-inspector/definitions';
import { BoringsslInspectorHandlers } from '@server/domains/boringssl-inspector/handlers';
import { asJsonResponse, toolErrorToResponse } from '@server/domains/shared/response';
import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, toolLookup } from '@server/domains/shared/registry';

const DOMAIN = 'boringssl-inspector' as const;
const DEP_KEY = 'boringsslInspectorHandlers' as const;
const PROFILES: Array<'workflow' | 'full'> = ['workflow', 'full'];

type H = BoringsslInspectorHandlers;

const lookup = toolLookup(boringsslInspectorTools);
const bind = (invoke: (handler: H, args: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, async (handler, args) => {
    try {
      return asJsonResponse(await invoke(handler, args));
    } catch (error) {
      return toolErrorToResponse(error);
    }
  });

function ensure(ctx: MCPServerContext): H {
  const existing = ctx.getDomainInstance<BoringsslInspectorHandlers>(DEP_KEY);
  if (existing) {
    return existing;
  }

  const handlers = new BoringsslInspectorHandlers(new TLSKeyLogExtractor());
  ctx.setDomainInstance(DEP_KEY, handlers);
  return handlers;
}

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: PROFILES,
  registrations: [
    {
      tool: lookup('tls_keylog_enable'),
      domain: DOMAIN,
      bind: bind((handler, args) => handler.handleTlsKeylogEnable(args)),
    },
    {
      tool: lookup('tls_keylog_parse'),
      domain: DOMAIN,
      bind: bind((handler, args) => handler.handleTlsKeylogParse(args)),
    },
    {
      tool: lookup('tls_cert_pin_bypass'),
      domain: DOMAIN,
      bind: bind((handler, args) => handler.handleTlsCertPinBypass(args)),
    },
    {
      tool: lookup('tls_handshake_parse'),
      domain: DOMAIN,
      bind: bind((handler, args) => handler.handleTlsHandshakeParse(args)),
    },
    {
      tool: lookup('tls_parse_handshake'),
      domain: DOMAIN,
      bind: bind((handler, args) => handler.handleParseHandshake(args)),
    },
    {
      tool: lookup('tls_cipher_suites'),
      domain: DOMAIN,
      bind: bind((handler, args) => handler.handleCipherSuites(args)),
    },
    {
      tool: lookup('tls_parse_certificate'),
      domain: DOMAIN,
      bind: bind((handler, args) => handler.handleParseCertificate(args)),
    },
    {
      tool: lookup('tls_cert_pin_bypass_frida'),
      domain: DOMAIN,
      bind: bind((handler, args) => handler.handleBypassCertPinning(args)),
    },
  ],
  ensure,
  toolDependencies: [
    {
      from: 'network',
      to: 'boringssl-inspector',
      relation: 'uses',
      weight: 0.8,
    },
  ],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
