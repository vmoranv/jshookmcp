export type {
  AsarFileEntry,
  FsStats,
  MiniappPkgEntry,
  MiniappPkgScanItem,
  ParsedAsar,
  ParsedMiniappPkg,
} from './platform-utils.js';

export {
  checkExternalCommand,
  extractAppIdFromPath,
  getCollectorState,
  getDefaultSearchPaths,
  isRecord,
  parseBooleanArg,
  parseStringArg,
  pathExists,
  readJsonFileSafe,
  resolveOutputDirectory,
  resolveSafeOutputPath,
  sanitizeArchiveRelativePath,
  toDisplayPath,
  toErrorResponse,
  toStringArray,
  toTextResponse,
  walkDirectory,
} from './platform-utils.js';
export { MiniappHandlers } from './miniapp-handlers.js';
export { ElectronHandlers } from './electron-handlers.js';
export { BridgeHandlers } from './bridge-handlers.js';
