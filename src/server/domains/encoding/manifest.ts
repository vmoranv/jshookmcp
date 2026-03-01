import type { ToolRegistration } from '../../registry/types.js';
import { toolLookup } from '../../registry/types.js';
import { encodingTools } from './definitions.js';

const t = toolLookup(encodingTools);

export const encodingRegistrations: readonly ToolRegistration[] = [
  { tool: t('binary_detect_format'), domain: 'encoding', bind: (d) => (a) => d.encodingHandlers.handleBinaryDetectFormat(a) },
  { tool: t('binary_decode'), domain: 'encoding', bind: (d) => (a) => d.encodingHandlers.handleBinaryDecode(a) },
  { tool: t('binary_encode'), domain: 'encoding', bind: (d) => (a) => d.encodingHandlers.handleBinaryEncode(a) },
  { tool: t('binary_entropy_analysis'), domain: 'encoding', bind: (d) => (a) => d.encodingHandlers.handleBinaryEntropyAnalysis(a) },
  { tool: t('protobuf_decode_raw'), domain: 'encoding', bind: (d) => (a) => d.encodingHandlers.handleProtobufDecodeRaw(a) },
];
