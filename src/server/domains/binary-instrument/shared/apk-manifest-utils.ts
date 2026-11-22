/**
 * APK manifest XML parsing utilities.
 *
 * The implementation moved to `@modules/binary-instrument/apk-manifest` so the
 * module layer and this domain share one parser. Keep this path for existing
 * domain imports and tests.
 */
export { listTags, summarizeManifestXml } from '@modules/binary-instrument/apk-manifest';
export type { ManifestParseLimits, ManifestSummary } from '@modules/binary-instrument/apk-manifest';
