/**
 * Android `getprop` output parser + device fingerprint summary builder.
 *
 * `adb shell getprop` (no arguments) dumps every system property, one per line,
 * as `[ro.build.version.sdk]: [33]`. This parser lifts that dump into structured
 * {key, value} entries, and the fingerprint builder curates the build/product/boot
 * fields that matter for reverse-engineering targeting (SDK, ABI, security patch,
 * build fingerprint, bootloader lock state).
 *
 * Pure functions only — no adb subprocess contact — so they are CI-verifiable
 * from synthetic fixtures without a connected device.
 */

export interface GetpropEntry {
  key: string;
  value: string;
}

export interface GetpropFingerprint {
  model?: string;
  manufacturer?: string;
  brand?: string;
  device?: string;
  product?: string;
  release?: string;
  sdk?: string;
  abi?: string;
  abiList?: string;
  buildId?: string;
  buildFingerprint?: string;
  securityPatch?: string;
  buildTags?: string;
  buildType?: string;
  verifiedBoot?: string;
  bootloaderLock?: string;
}

// `[ro.product.cpu.abi]: [arm64-v8a]` — value may be empty (`[key]: []`).
// Values do not contain `]` in practice; bracket contents are captured lazily.
const GETPROP_LINE_RE = /^\[([^\]]*)\]:\s*\[([^\]]*)\]$/;

/**
 * Parse raw `getprop` stdout into {key, value} entries.
 *
 * Blank lines, the bare `[]: []` placeholder, and lines that do not match the
 * `[key]: [value]` shape are skipped. Empty-string values are preserved so
 * callers can distinguish "unset" from "absent".
 */
export function parseGetprop(stdout: string): GetpropEntry[] {
  const entries: GetpropEntry[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(GETPROP_LINE_RE);
    if (!match) continue;
    const key = match[1] ?? '';
    const value = match[2] ?? '';
    if (!key) continue;
    entries.push({ key, value });
  }
  return entries;
}

/** Field name → system property key for the curated fingerprint summary. */
const FINGERPRINT_FIELDS: ReadonlyArray<readonly [keyof GetpropFingerprint, string]> = [
  ['model', 'ro.product.model'],
  ['manufacturer', 'ro.product.manufacturer'],
  ['brand', 'ro.product.brand'],
  ['device', 'ro.product.device'],
  ['product', 'ro.product.name'],
  ['release', 'ro.build.version.release'],
  ['sdk', 'ro.build.version.sdk'],
  ['abi', 'ro.product.cpu.abi'],
  ['abiList', 'ro.product.cpu.abilist'],
  ['buildId', 'ro.build.id'],
  ['buildFingerprint', 'ro.build.fingerprint'],
  ['securityPatch', 'ro.build.version.security_patch'],
  ['buildTags', 'ro.build.tags'],
  ['buildType', 'ro.build.type'],
  ['verifiedBoot', 'ro.boot.verifiedbootstate'],
  ['bootloaderLock', 'ro.boot.vbmeta.device_state'],
];

/**
 * Build a curated device fingerprint from a parsed property map.
 *
 * Bootloader lock state prefers `ro.boot.vbmeta.device_state` (modern Android)
 * but accepts the legacy `ro.boot.flash.locked` sentinel ("1" → "locked") when
 * the device-state property is absent. Only present fields are emitted, so an
 * empty property map yields an empty fingerprint object.
 */
export function buildFingerprintSummary(properties: Record<string, string>): GetpropFingerprint {
  const fingerprint: GetpropFingerprint = {};
  for (const [field, propKey] of FINGERPRINT_FIELDS) {
    const value = properties[propKey];
    if (value === undefined) continue;
    (fingerprint[field] as string | undefined) = value;
  }
  if (fingerprint.bootloaderLock === undefined) {
    const flashLocked = properties['ro.boot.flash.locked'];
    if (flashLocked === '1') fingerprint.bootloaderLock = 'locked';
    else if (flashLocked === '0') fingerprint.bootloaderLock = 'unlocked';
  }
  return fingerprint;
}
