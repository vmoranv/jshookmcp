import type { ToolRegistration } from '../../registry/types.js';
import { toolLookup } from '../../registry/types.js';
import { transformTools } from './definitions.js';

const t = toolLookup(transformTools);

export const transformRegistrations: readonly ToolRegistration[] = [
  { tool: t('ast_transform_preview'), domain: 'transform', bind: (d) => (a) => d.transformHandlers.handleAstTransformPreview(a) },
  { tool: t('ast_transform_chain'), domain: 'transform', bind: (d) => (a) => d.transformHandlers.handleAstTransformChain(a) },
  { tool: t('ast_transform_apply'), domain: 'transform', bind: (d) => (a) => d.transformHandlers.handleAstTransformApply(a) },
  { tool: t('crypto_extract_standalone'), domain: 'transform', bind: (d) => (a) => d.transformHandlers.handleCryptoExtractStandalone(a) },
  { tool: t('crypto_test_harness'), domain: 'transform', bind: (d) => (a) => d.transformHandlers.handleCryptoTestHarness(a) },
  { tool: t('crypto_compare'), domain: 'transform', bind: (d) => (a) => d.transformHandlers.handleCryptoCompare(a) },
];
