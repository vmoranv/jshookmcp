import { tlsInspectorTools } from '@server/domains/tls-inspector/definitions';
import type { TlsInspectorHandlers } from '@server/domains/tls-inspector/handlers';
import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { defineMethodRegistrations, toolLookup } from '@server/domains/shared/registry';

const DOMAIN = 'tls-inspector' as const;
const DEP_KEY = 'tlsInspectorHandlers' as const;

type H = TlsInspectorHandlers;

const lookup = toolLookup(tlsInspectorTools);
const registrations = defineMethodRegistrations<H, (typeof tlsInspectorTools)[number]['name']>({
  domain: DOMAIN,
  depKey: DEP_KEY,
  lookup,
  entries: [
    { tool: 'tls_keylog_enable', method: 'handleTlsKeylogEnableTool' },
    { tool: 'tls_keylog_parse', method: 'handleTlsKeylogParseTool' },
    { tool: 'tls_keylog_disable', method: 'handleTlsKeylogDisableTool' },
    { tool: 'tls_keylog_seal', method: 'handleTlsKeylogSealTool' },
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
  const { TlsInspectorHandlers } = await import('@server/domains/tls-inspector/handlers');
  const { TLSKeyLogExtractor } = await import('@modules/tls-inspector');
  const existing = ctx.getDomainInstance<TlsInspectorHandlers>(DEP_KEY);
  if (existing) {
    return existing;
  }

  const handlers = new TlsInspectorHandlers(new TLSKeyLogExtractor());

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

// ── Document-expansion keywords (search retrieval layer) ──
// Query phrases bridging user vocabulary to this tool's vocabulary without
// duplicating name/description tokens. Folded into generated-tool-catalog by
// scripts/generate-domains-index.mjs; weighted SEARCH_SCENE_KEYWORD_WEIGHT.
const SCENE_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  tls_open: ['open raw tls socket', 'connect tls endpoint manually', '建 tls 连接'],
  tls_write: ['send bytes on tls', 'push data into tls session', 'tls 写数据'],
  tls_read_until: ['wait for tls response bytes', 'read until marker', 'tls 读数据'],
  tls_close: ['shut tls socket', 'tear down tls session', '关闭 tls'],
  tls_parse_handshake: ['decode client hello', 'dissect handshake bytes', '解析握手'],
  tls_parse_certificate: ['decode x509 cert', 'read certificate chain', '解析证书'],
  tls_cipher_suites: ['list supported ciphers', 'negotiated cipher info', '密码套件'],
  tls_decrypt_payload: [
    'decrypt with keylog secrets',
    'decode tls application data',
    '解密 tls 载荷',
  ],
  tls_keylog_enable: ['start ssl key logging', 'capture session secrets', '开启密钥日志'],
  tls_keylog_disable: ['stop ssl key logging', 'turn off secret capture', '关闭密钥日志'],
  tls_keylog_parse: ['read sslkeylog file', 'parse secret log lines', '解析密钥日志'],
  tls_keylog_lookup_secret: ['find secret for connection', 'match client random', '查密钥'],
  tls_keylog_seal: ['hmac seal the keylog', 'tamper-proof secret file', '封存密钥日志'],
  tls_keylog_summarize: ['keylog overview stats', 'summarize sealed secrets', '密钥日志摘要'],
  tls_probe_endpoint: [
    'test tls handshake against host',
    'check negotiated parameters',
    '探测 tls 端点',
  ],
  tls_cert_pin_bypass: [
    'defeat certificate pinning natively',
    'ignore cert mismatch',
    '绕过证书绑定',
  ],
  tls_cert_pin_bypass_frida: [
    'unpin certs via frida script',
    'frida ssl unpinning',
    'frida 绕过绑定',
  ],
  net_raw_tcp_listen: ['listen on a tcp port', 'accept raw tcp connections', '监听 tcp'],
  net_raw_tcp_send: ['push bytes over tcp', 'raw tcp client send', 'tcp 发送'],
  net_raw_udp_listen: ['listen on a udp port', 'accept udp datagrams', '监听 udp'],
  net_raw_udp_send: ['send udp datagram', 'raw udp packet out', 'udp 发送'],
  tcp_open: ['open raw tcp connection', 'dial a tcp socket', '建 tcp 连接'],
  tcp_write: ['send bytes over tcp', 'write to socket', 'tcp 写数据'],
  tcp_read_until: ['read tcp until pattern', 'wait for bytes', 'tcp 读数据'],
  tcp_close: ['close tcp socket', 'drop raw connection', '关闭 tcp'],
  websocket_open: ['open websocket by hand', 'manual ws handshake', '建 ws 连接'],
  websocket_send_frame: ['push ws frame manually', 'send raw websocket message', '发送 ws 帧'],
  websocket_read_frame: ['receive ws frame manually', 'wait for websocket message', '接收 ws 帧'],
  websocket_close: ['close manual websocket', 'tear down ws socket', '关闭 ws'],
};

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  // Inline array literal, not a named constant. scripts/generate-domains-index.mjs
  // scrapes the `profiles` array literal out of the manifest source to build
  // DOMAIN_PROFILE_MAP, which the runtime `getDomainsForProfile` gate reads.
  // Routing it through a `const PROFILES: Array<...>` declaration made that
  // scrape miss, fall back to ['full'], and silently diverge the runtime profile
  // gate from the docs (which import the real manifest and saw workflow + full).
  //
  // Do not spell the scraped key followed by a literal `[` anywhere above this
  // line — the scraper takes the FIRST regex match in the file, so even a
  // comment mentioning the key can hijack it.
  profiles: ['workflow', 'full'],
  registrations,

  // Document-expansion keywords for the retrieval layer (SCENE_KEYWORDS above).
  sceneKeywords: SCENE_KEYWORDS,

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
      to: 'tls-inspector',
      relation: 'uses',
      weight: 0.8,
    },
  ],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
