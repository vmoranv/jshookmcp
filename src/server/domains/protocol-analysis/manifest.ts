import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { defineMethodRegistrations, toolLookup } from '@server/domains/shared/registry';
import { protocolAnalysisTools } from './definitions';
import type { ProtocolAnalysisHandlers } from './handlers';

const DOMAIN = 'protocol-analysis';
const DEP_KEY = 'protocolAnalysisHandlers';
type H = ProtocolAnalysisHandlers;
const t = toolLookup(protocolAnalysisTools);
const registrations = defineMethodRegistrations<H, (typeof protocolAnalysisTools)[number]['name']>({
  domain: DOMAIN,
  depKey: DEP_KEY,
  lookup: t,
  entries: [
    { tool: 'proto_define_pattern', method: 'handleDefinePatternTool' },
    { tool: 'proto_auto_detect', method: 'handleAutoDetectTool' },
    { tool: 'proto_infer_fields', method: 'handleInferFieldsTool' },
    { tool: 'proto_infer_state_machine', method: 'handleInferStateMachineTool' },
    { tool: 'proto_export_schema', method: 'handleExportSchemaTool' },
    { tool: 'proto_visualize_state', method: 'handleVisualizeStateTool' },
    { tool: 'payload_template_build', method: 'handlePayloadTemplateBuildTool' },
    { tool: 'payload_mutate', method: 'handlePayloadMutateTool' },
    { tool: 'ethernet_frame_build', method: 'handleEthernetFrameBuildTool' },
    { tool: 'arp_build', method: 'handleArpBuildTool' },
    { tool: 'raw_ip_packet_build', method: 'handleRawIpPacketBuildTool' },
    { tool: 'icmp_echo_build', method: 'handleIcmpEchoBuildTool' },
    { tool: 'checksum_apply', method: 'handleChecksumApplyTool' },
    { tool: 'pcap_write', method: 'handlePcapWriteTool' },
    { tool: 'pcap_read', method: 'handlePcapReadTool' },
    { tool: 'pcapng_write', method: 'handlePcapngWriteTool' },
    { tool: 'pcapng_read', method: 'handlePcapngReadTool' },
    { tool: 'proto_dissect_dns', method: 'handleProtoDissectDnsTool' },
    { tool: 'proto_dissect_http', method: 'handleProtoDissectHttpTool' },
    { tool: 'proto_fingerprint', method: 'handleProtoFingerprintTool' },
  ],
});

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { ProtocolAnalysisHandlers } = await import('./handlers');
  const existing = ctx.getDomainInstance<H>(DEP_KEY);
  if (existing) {
    return existing;
  }

  const handlers = new ProtocolAnalysisHandlers(
    undefined,
    undefined,
    ctx.eventBus,
    ctx.taskManager,
  );
  ctx.setDomainInstance(DEP_KEY, handlers);
  return handlers;
}

// ── Document-expansion keywords (search retrieval layer) ──
// Query phrases bridging user vocabulary to this tool's vocabulary without
// duplicating name/description tokens. Folded into generated-tool-catalog by
// scripts/generate-domains-index.mjs; weighted SEARCH_SCENE_KEYWORD_WEIGHT.
const SCENE_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  arp_build: ['craft an arp packet', 'build arp frame bytes', '构造 arp 包'],
  checksum_apply: ['fix the packet checksum', 'recompute checksums', '计算校验和'],
  ethernet_frame_build: ['craft an ethernet frame', 'build l2 frame bytes', '构造以太网帧'],
  icmp_echo_build: ['craft an icmp ping packet', 'build icmp echo bytes', '构造 icmp 包'],
  payload_mutate: ['mutate the payload bytes', 'fuzz the packet content', '变异载荷'],
  payload_template_build: ['build packet from template', 'create payload template', '载荷模板'],
  pcap_read: ['read a pcap capture file', 'open packet dump', '读 pcap'],
  pcap_write: ['write packets to pcap', 'save capture file', '写 pcap'],
  pcapng_read: ['read a pcapng file', 'open next-gen capture', '读 pcapng'],
  pcapng_write: ['write pcapng capture', 'save next-gen packet dump', '写 pcapng'],
  proto_auto_detect: [
    'guess the protocol automatically',
    'identify protocol from bytes',
    '自动识别协议',
  ],
  proto_define_pattern: [
    'define a protocol pattern',
    'describe my custom protocol',
    '定义协议模式',
  ],
  proto_dissect_dns: ['dissect dns packet bytes', 'parse dns message', '解析 dns 包'],
  proto_dissect_http: ['dissect http bytes', 'parse raw http message', '解析 http 包'],
  proto_export_schema: ['export the protocol schema', 'save dissected format', '导出协议 schema'],
  proto_fingerprint: ['fingerprint the protocol dialect', 'identify protocol variant', '协议指纹'],
  proto_infer_fields: ['infer field boundaries', 'guess packet field layout', '推断字段'],
  proto_infer_state_machine: [
    'infer the protocol state machine',
    'learn message sequence',
    '推断状态机',
  ],
  proto_visualize_state: [
    'draw the state machine',
    'visualize protocol transitions',
    '可视化状态机',
  ],
  raw_ip_packet_build: ['craft a raw ip packet', 'build l3 packet bytes', '构造 ip 包'],
};

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['full'],
  ensure,
  registrations,
  prerequisites: {
    proto_auto_detect: [
      {
        condition: 'At least one hex payload sample is required',
        fix: 'Capture traffic using network monitoring tools first',
      },
    ],
    proto_infer_state_machine: [
      {
        condition: 'Multiple message samples are required for state machine inference',
        fix: 'Capture message sequences with mojo-ipc or network tools',
      },
    ],
  },
  workflowRule: {
    patterns: [
      /protocol\s+(reverse|analysis|pattern|state\s*machine|schema)/i,
      /custom\s+protocol|binary\s+protocol|wire\s+format/i,
      /infer\s+(protocol|fields|state\s*machine)/i,
      /proto.*export|proto.*schema|proto.*diagram/i,
      /payload\s+(template|build|mutate)|packet\s+(template|mutate)/i,
      /ethernet|arp|ipv4|ipv6|pcap|internet\s+checksum|raw\s+packet/i,
      /(decode|payload|bytes?|hex|protobuf|msgpack).*(protocol|field|state\s*machine)/i,
      /(base64|hex|protobuf|msgpack).*(payload|protocol|field|decode)/i,
      /(crypto\s*harness|checksum|payload\s+rebuild|payload\s+template).*(protocol|payload|decode)/i,
      /(无状态|纯算|确定性|解码|载荷|字节|报文).*(协议|字段|状态机)/i,
    ],
    priority: 0.6,
    tools: [
      'binary_detect_format',
      'binary_decode',
      'proto_auto_detect',
      'proto_infer_fields',
      'proto_define_pattern',
      'proto_infer_state_machine',
      'proto_export_schema',
      'proto_visualize_state',
      'payload_template_build',
      'payload_mutate',
      'checksum_apply',
      'crypto_test_harness',
      'ethernet_frame_build',
      'arp_build',
      'raw_ip_packet_build',
      'icmp_echo_build',
      'pcap_write',
      'pcap_read',
      'pcapng_write',
      'pcapng_read',
      'proto_dissect_dns',
      'proto_dissect_http',
    ],
    hint:
      'Capture or craft packet bytes -> build Ethernet/ARP/IP/ICMP headers -> apply deterministic checksums and ' +
      'payload mutations -> read/write PCAP or PCAPNG files -> dissect DNS/HTTP payloads or infer fields/state ' +
      'machines from resulting payloads',
  },
  toolDependencies: [
    {
      from: 'network_get_requests',
      to: 'binary_decode',
      relation: 'suggests',
      weight: 0.9,
    },
    {
      from: 'binary_decode',
      to: 'proto_auto_detect',
      relation: 'precedes',
      weight: 0.95,
    },
    {
      from: 'proto_auto_detect',
      to: 'proto_infer_fields',
      relation: 'precedes',
      weight: 0.95,
    },
    {
      from: 'proto_infer_fields',
      to: 'proto_infer_state_machine',
      relation: 'precedes',
      weight: 0.9,
    },
    {
      from: 'detect_crypto',
      to: 'crypto_test_harness',
      relation: 'suggests',
      weight: 0.8,
    },
    {
      from: 'network',
      to: 'protocol-analysis',
      relation: 'uses',
      weight: 0.7,
    },
  ],

  // Document-expansion keywords (SCENE_KEYWORDS above).
  sceneKeywords: SCENE_KEYWORDS,
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
