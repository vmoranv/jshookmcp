import type { ToolRegistration } from '../../registry/types.js';
import { toolLookup } from '../../registry/types.js';
import { platformTools } from './definitions.js';

const t = toolLookup(platformTools);

export const platformRegistrations: readonly ToolRegistration[] = [
  { tool: t('miniapp_pkg_scan'), domain: 'platform', bind: (d) => (a) => d.platformHandlers.handleMiniappPkgScan(a) },
  { tool: t('miniapp_pkg_unpack'), domain: 'platform', bind: (d) => (a) => d.platformHandlers.handleMiniappPkgUnpack(a) },
  { tool: t('miniapp_pkg_analyze'), domain: 'platform', bind: (d) => (a) => d.platformHandlers.handleMiniappPkgAnalyze(a) },
  { tool: t('asar_extract'), domain: 'platform', bind: (d) => (a) => d.platformHandlers.handleAsarExtract(a) },
  { tool: t('electron_inspect_app'), domain: 'platform', bind: (d) => (a) => d.platformHandlers.handleElectronInspectApp(a) },
  { tool: t('frida_bridge'), domain: 'platform', bind: (d) => (a) => d.platformHandlers.handleFridaBridge(a) },
  { tool: t('jadx_bridge'), domain: 'platform', bind: (d) => (a) => d.platformHandlers.handleJadxBridge(a) },
];
