import type { ToolRegistration } from '../../registry/types.js';
import { toolLookup } from '../../registry/types.js';
import { coreTools } from './definitions.js';

const t = toolLookup(coreTools);

export const analysisRegistrations: readonly ToolRegistration[] = [
  { tool: t('collect_code'), domain: 'core', bind: (d) => (a) => d.coreAnalysisHandlers.handleCollectCode(a) },
  { tool: t('search_in_scripts'), domain: 'core', bind: (d) => (a) => d.coreAnalysisHandlers.handleSearchInScripts(a) },
  { tool: t('extract_function_tree'), domain: 'core', bind: (d) => (a) => d.coreAnalysisHandlers.handleExtractFunctionTree(a) },
  { tool: t('deobfuscate'), domain: 'core', bind: (d) => (a) => d.coreAnalysisHandlers.handleDeobfuscate(a) },
  { tool: t('understand_code'), domain: 'core', bind: (d) => (a) => d.coreAnalysisHandlers.handleUnderstandCode(a) },
  { tool: t('detect_crypto'), domain: 'core', bind: (d) => (a) => d.coreAnalysisHandlers.handleDetectCrypto(a) },
  { tool: t('manage_hooks'), domain: 'core', bind: (d) => (a) => d.coreAnalysisHandlers.handleManageHooks(a) },
  { tool: t('detect_obfuscation'), domain: 'core', bind: (d) => (a) => d.coreAnalysisHandlers.handleDetectObfuscation(a) },
  { tool: t('advanced_deobfuscate'), domain: 'core', bind: (d) => (a) => d.coreAnalysisHandlers.handleAdvancedDeobfuscate(a) },
  { tool: t('clear_collected_data'), domain: 'core', bind: (d) => () => d.coreAnalysisHandlers.handleClearCollectedData() },
  { tool: t('get_collection_stats'), domain: 'core', bind: (d) => () => d.coreAnalysisHandlers.handleGetCollectionStats() },
  { tool: t('webpack_enumerate'), domain: 'core', bind: (d) => (a) => d.coreAnalysisHandlers.handleWebpackEnumerate(a) },
  { tool: t('source_map_extract'), domain: 'core', bind: (d) => (a) => d.coreAnalysisHandlers.handleSourceMapExtract(a) },
];
