import type { ToolRegistration } from '../../registry/types.js';
import { toolLookup } from '../../registry/types.js';
import { sourcemapTools } from './definitions.js';

const t = toolLookup(sourcemapTools);

export const sourcemapRegistrations: readonly ToolRegistration[] = [
  { tool: t('sourcemap_discover'), domain: 'sourcemap', bind: (d) => (a) => d.sourcemapHandlers.handleSourcemapDiscover(a) },
  { tool: t('sourcemap_fetch_and_parse'), domain: 'sourcemap', bind: (d) => (a) => d.sourcemapHandlers.handleSourcemapFetchAndParse(a) },
  { tool: t('sourcemap_reconstruct_tree'), domain: 'sourcemap', bind: (d) => (a) => d.sourcemapHandlers.handleSourcemapReconstructTree(a) },
  { tool: t('extension_list_installed'), domain: 'sourcemap', bind: (d) => (a) => d.sourcemapHandlers.handleExtensionListInstalled(a) },
  { tool: t('extension_execute_in_context'), domain: 'sourcemap', bind: (d) => (a) => d.sourcemapHandlers.handleExtensionExecuteInContext(a) },
];
