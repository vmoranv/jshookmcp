import { boringsslInspectorTools } from '@server/domains/boringssl-inspector/definitions';
import type { BoringsslInspectorHandlers } from '@server/domains/boringssl-inspector/handlers';
import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { defineMethodRegistrations, toolLookup } from '@server/domains/shared/registry';

const DOMAIN = 'boringssl-inspector' as const;
const DEP_KEY = 'boringsslInspectorHandlers' as const;
const PROFILES: Array<'workflow' | 'full'> = ['workflow', 'full'];

type H = BoringsslInspectorHandlers;

const lookup = toolLookup(boringsslInspectorTools);
const registrations = defineMethodRegistrations<
  H,
  (typeof boringsslInspectorTools)[number]['name']
>({
  domain: DOMAIN,
  depKey: DEP_KEY,
  lookup,
  entries: [
    { tool: 'tls_keylog_enable', method: 'handleTlsKeylogEnableTool' },
    { tool: 'tls_keylog_parse', method: 'handleTlsKeylogParseTool' },
    { tool: 'tls_keylog_disable', method: 'handleTlsKeylogDisableTool' },
    { tool: 'tls_decrypt_payload', method: 'handleTlsDecryptPayloadTool' },
    { tool: 'tls_keylog_summarize', method: 'handleTlsKeylogSummarizeTool' },
    { tool: 'tls_keylog_lookup_secret', method: 'handleTlsKeylogLookupSecretTool' },
    { tool: 'tls_cert_pin_bypass', method: 'handleTlsCertPinBypassTool' },
    { tool: 'tls_parse_handshake', method: 'handleParseHandshakeTool' },
    { tool: 'tls_cipher_suites', method: 'handleCipherSuitesTool' },
    { tool: 'tls_parse_certificate', method: 'handleParseCertificateTool' },
    { tool: 'tls_probe_endpoint', method: 'handleTlsProbeEndpointTool' },
    { tool: 'tcp_open', method: 'handleTcpOpenTool' },
    { tool: 'tcp_write', method: 'handleTcpWriteTool' },
    { tool: 'tcp_read_until', method: 'handleTcpReadUntilTool' },
    { tool: 'tcp_close', method: 'handleTcpCloseTool' },
    { tool: 'tls_open', method: 'handleTlsOpenTool' },
    { tool: 'tls_write', method: 'handleTlsWriteTool' },
    { tool: 'tls_read_until', method: 'handleTlsReadUntilTool' },
    { tool: 'tls_close', method: 'handleTlsCloseTool' },
    { tool: 'websocket_open', method: 'handleWebSocketOpenTool' },
    { tool: 'websocket_send_frame', method: 'handleWebSocketSendFrameTool' },
    { tool: 'websocket_read_frame', method: 'handleWebSocketReadFrameTool' },
    { tool: 'websocket_close', method: 'handleWebSocketCloseTool' },
    { tool: 'tls_cert_pin_bypass_frida', method: 'handleBypassCertPinningTool' },
    { tool: 'net_raw_tcp_send', method: 'handleRawTcpSendTool' },
    { tool: 'net_raw_tcp_listen', method: 'handleRawTcpListenTool' },
    { tool: 'net_raw_udp_send', method: 'handleRawUdpSendTool' },
    { tool: 'net_raw_udp_listen', method: 'handleRawUdpListenTool' },
  ],
});

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { BoringsslInspectorHandlers } =
    await import('@server/domains/boringssl-inspector/handlers');
  const { TLSKeyLogExtractor } = await import('@modules/boringssl-inspector');
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
  registrations,
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
    hint:
      'TLS/WebSocket analysis: probe endpoint → open ws/wss session → exchange frames → inspect' +
      'trust/cipher/ALPN → enable keylog or bypass pinning when needed.',
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
