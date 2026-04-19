export type {
  AsarFileEntry,
  FsStats,
  MiniappPkgEntry,
  MiniappPkgScanItem,
  ParsedAsar,
  ParsedMiniappPkg,
} from '@server/domains/platform/handlers/platform-utils';

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
} from '@server/domains/platform/handlers/platform-utils';
export { MiniappHandlers } from '@server/domains/platform/handlers/miniapp-handlers';
export { ElectronHandlers } from '@server/domains/platform/handlers/electron-handlers';
