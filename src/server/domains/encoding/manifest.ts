import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import {
  defineMethodRegistrations,
  ensureBrowserCore,
  toolLookup,
} from '@server/domains/shared/registry';
import { encodingTools } from '@server/domains/encoding/definitions';
import type { EncodingToolHandlers } from '@server/domains/encoding/index';

const DOMAIN = 'encoding' as const;
const DEP_KEY = 'encodingHandlers' as const;
type H = EncodingToolHandlers;
const t = toolLookup(encodingTools);
const registrations = defineMethodRegistrations<H, (typeof encodingTools)[number]['name']>({
  domain: DOMAIN,
  depKey: DEP_KEY,
  lookup: t,
  entries: [
    { tool: 'binary_detect_format', method: 'handleBinaryDetectFormatTool' },
    { tool: 'binary_decode', method: 'handleBinaryDecodeTool' },
    { tool: 'binary_encode', method: 'handleBinaryEncodeTool' },
    { tool: 'binary_entropy_analysis', method: 'handleBinaryEntropyAnalysisTool' },
    { tool: 'protobuf_decode_raw', method: 'handleProtobufDecodeRawTool' },
  ],
});

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { EncodingToolHandlers } = await import('@server/domains/encoding/index');
  await ensureBrowserCore(ctx);
  if (!ctx.encodingHandlers) {
    ctx.encodingHandlers = new EncodingToolHandlers(
      ctx.collector!,
      async (requestId) => ctx.consoleMonitor?.getResponseBody(requestId) ?? null,
    );
  }
  return ctx.encodingHandlers;
}

// ── Document-expansion keywords (search retrieval layer) ──
// Query phrases bridging user vocabulary to this tool's vocabulary without
// duplicating name/description tokens. Folded into generated-tool-catalog by
// scripts/generate-domains-index.mjs; weighted SEARCH_SCENE_KEYWORD_WEIGHT.
const SCENE_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  binary_decode: [
    'decode base64 blob',
    'turn hex into bytes',
    '解码二进制',
    'blob to raw bytes conversion',
  ],
  binary_detect_format: ['identify file type', 'magic bytes sniff', '识别文件格式'],
  binary_encode: ['encode bytes to base64', 'serialize buffer', '编码二进制'],
  binary_entropy_analysis: ['measure randomness', 'shannon entropy of bytes', '熵分析'],
  protobuf_decode_raw: ['decode protobuf without schema', 'parse wire format', '解析 protobuf'],
};

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['workflow', 'full'],
  ensure,
  registrations,

  // Document-expansion keywords for the retrieval layer (SCENE_KEYWORDS above).
  sceneKeywords: SCENE_KEYWORDS,
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
