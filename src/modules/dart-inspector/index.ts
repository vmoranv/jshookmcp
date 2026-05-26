/**
 * Barrel re-exports for the dart-inspector module. Keeps imports
 * `@modules/dart-inspector` short for downstream code.
 */

export { StringsExtractor } from './StringsExtractor';
export { SmiScanner } from './SmiScanner';
export { Symbolizer } from './Symbolizer';
export { PackageDetector } from './PackageDetector';
export { SnapshotFingerprint } from './SnapshotFingerprint';
export {
  SNAPSHOT_VERSION_TABLE,
  loadVersionTable,
  resetUserTableCacheForTests,
} from './snapshot-version-table';

export { DART_SNAPSHOT_MAGIC } from './snapshot-types';
export type {
  SnapshotHeader,
  SnapshotKind,
  SnapshotArch,
  SnapshotSource,
  VersionFingerprint,
  VersionEntry,
  ParseOptions,
  FingerprintOptions,
} from './snapshot-types';
