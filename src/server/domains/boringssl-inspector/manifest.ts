import { TLSKeyLogExtractor } from '@modules/boringssl-inspector';
import { boringsslInspectorTools } from '@server/domains/boringssl-inspector/definitions';
import { BoringsslInspectorHandlers } from '@server/domains/boringssl-inspector/handlers';
import { asJsonResponse } from '@server/domains/shared/response';
import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, toolLookup } from '@server/domains/shared/registry';

const DOMAIN = 'boringssl-inspector' as const;
const DEP_KEY = 'boringsslInspectorHandlers' as const;
const PROFILES: Array<'workflow' | 'full'> = ['workflow', 'full'];

type H = BoringsslInspectorHandlers;

const lookup = toolLookup(boringsslInspectorTools);
const bind = (invoke: (handler: H, args: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, async (handler, args) => {
    return asJsonResponse(await invoke(handler, args));
  });

function ensure(ctx: MCPServerContext): H {
  const existing = ctx.getDomainInstance<BoringsslInspectorHandlers>(DEP_KEY);
  if (existing) {
    return existing;
  }

  const handlers = new BoringsslInspectorHandlers(new TLSKeyLogExtractor());

  // Wire extension invoke for automated Frida cert-pinning bypass
  handlers.setExtensionInvoke(async (args: unknown) => {
    try {
      const binaryInstrument = ctx.getDomainInstance<Record<string, unknown>>(
        'binaryInstrumentHandlers',
      );
      if (binaryInstrument && typeof binaryInstrument.handleFridaRunScript === 'function') {
        return binaryInstrument.handleFridaRunScript(args);
      }
    } catch {
      // binary-instrument domain not loaded
    }
    return null;
  });

  // Wire event bus for boost rule activation
  handlers.setEventBus(ctx.eventBus);

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
      tool: lookup('tls_keylog_disable'),
      domain: DOMAIN,
      bind: bind((handler, args) => handler.handleTlsKeylogDisable(args)),
    },
    {
      tool: lookup('tls_decrypt_payload'),
      domain: DOMAIN,
      bind: bind((handler, args) => handler.handleTlsDecryptPayload(args)),
    },
    {
      tool: lookup('tls_keylog_summarize'),
      domain: DOMAIN,
      bind: bind((handler, args) => handler.handleTlsKeylogSummarize(args)),
    },
    {
      tool: lookup('tls_keylog_lookup_secret'),
      domain: DOMAIN,
      bind: bind((handler, args) => handler.handleTlsKeylogLookupSecret(args)),
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
      tool: lookup('tls_probe_endpoint'),
      domain: DOMAIN,
      bind: bind((handler, args) => handler.handleTlsProbeEndpoint(args)),
    },
    {
      tool: lookup('tcp_open'),
      domain: DOMAIN,
      bind: bind((handler, args) => handler.handleTcpOpen(args)),
    },
    {
      tool: lookup('tcp_write'),
      domain: DOMAIN,
      bind: bind((handler, args) => handler.handleTcpWrite(args)),
    },
    {
      tool: lookup('tcp_read_until'),
      domain: DOMAIN,
      bind: bind((handler, args) => handler.handleTcpReadUntil(args)),
    },
    {
      tool: lookup('tcp_close'),
      domain: DOMAIN,
      bind: bind((handler, args) => handler.handleTcpClose(args)),
    },
    {
      tool: lookup('tls_open'),
      domain: DOMAIN,
      bind: bind((handler, args) => handler.handleTlsOpen(args)),
    },
    {
      tool: lookup('tls_write'),
      domain: DOMAIN,
      bind: bind((handler, args) => handler.handleTlsWrite(args)),
    },
    {
      tool: lookup('tls_read_until'),
      domain: DOMAIN,
      bind: bind((handler, args) => handler.handleTlsReadUntil(args)),
    },
    {
      tool: lookup('tls_close'),
      domain: DOMAIN,
      bind: bind((handler, args) => handler.handleTlsClose(args)),
    },
    {
      tool: lookup('websocket_open'),
      domain: DOMAIN,
      bind: bind((handler, args) => handler.handleWebSocketOpen(args)),
    },
    {
      tool: lookup('websocket_send_frame'),
      domain: DOMAIN,
      bind: bind((handler, args) => handler.handleWebSocketSendFrame(args)),
    },
    {
      tool: lookup('websocket_read_frame'),
      domain: DOMAIN,
      bind: bind((handler, args) => handler.handleWebSocketReadFrame(args)),
    },
    {
      tool: lookup('websocket_close'),
      domain: DOMAIN,
      bind: bind((handler, args) => handler.handleWebSocketClose(args)),
    },
    {
      tool: lookup('tls_cert_pin_bypass_frida'),
      domain: DOMAIN,
      bind: bind((handler, args) => handler.handleBypassCertPinning(args)),
    },
    {
      tool: lookup('net_raw_tcp_send'),
      domain: DOMAIN,
      bind: bind((handler, args) => handler.handleRawTcpSend(args)),
    },
    {
      tool: lookup('net_raw_tcp_listen'),
      domain: DOMAIN,
      bind: bind((handler, args) => handler.handleRawTcpListen(args)),
    },
    {
      tool: lookup('net_raw_udp_send'),
      domain: DOMAIN,
      bind: bind((handler, args) => handler.handleRawUdpSend(args)),
    },
    {
      tool: lookup('net_raw_udp_listen'),
      domain: DOMAIN,
      bind: bind((handler, args) => handler.handleRawUdpListen(args)),
    },
    {
      tool: lookup('net_raw_tcp_scan'),
      domain: DOMAIN,
      bind: bind((handler, args) => handler.handleRawTcpScan(args)),
    },
  ],
  ensure,
  workflowRule: {
    patterns: [
      /\b(tls|ssl|boringssl|cert(ificate)?|pinning|handshake|keylog|websocket)\b/i,
      /(tls|ssl|cert|pinning|websocket).*(hook|bypass|intercept|dump|log|frame|session)/i,
    ],
    priority: 80,
    tools: [
      'tls_probe_endpoint',
      'websocket_open',
      'websocket_send_frame',
      'websocket_read_frame',
      'tls_keylog_enable',
      'tls_keylog_parse',
      'tls_decrypt_payload',
      'tls_cert_pin_bypass',
    ],
    hint: 'TLS/WebSocket analysis: probe endpoint → open ws/wss session → exchange frames → inspect trust/cipher/ALPN → enable keylog or bypass pinning when needed.',
  },
  prerequisites: {
    tls_probe_endpoint: [
      {
        condition: 'Target scope must be explicitly authorized and routable from the MCP host',
        fix: 'Verify target authorization, port reachability, and provide servername/custom CA options when needed',
      },
    ],
    tls_keylog_enable: [
      {
        condition: 'Target process must allow SSLKEYLOGFILE or be attachable by Frida',
        fix: 'Launch the target with SSLKEYLOGFILE env set, or enable Frida-based hooking',
      },
    ],
    tls_decrypt_payload: [
      {
        condition: 'A keylog session must be active with captured secrets',
        fix: 'Run tls_keylog_enable and reproduce TLS traffic before decrypting',
      },
    ],
    tls_cert_pin_bypass_frida: [
      {
        condition: 'Frida must be available on PATH and attached to the target',
        fix: 'Install Frida and attach via binary-instrument:frida_attach before running the bypass',
      },
    ],
  },
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
