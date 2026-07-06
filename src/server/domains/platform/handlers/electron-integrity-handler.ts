/**
 * electron_verify_integrity — Electron ASAR integrity verification.
 *
 * Electron embeds an `ElectronAsarIntegrity` JSON blob in the main process
 * binary (PE / Mach-O / ELF). Each entry maps an ASAR module path to a declared
 * hash of the ASAR header. At runtime, Electron validates the ASAR header
 * against this hash before loading — so a mismatch means the ASAR was tampered
 * with post-build. This tool parses the embedded JSON and verifies each entry
 * against the on-disk ASAR file, surfacing tamper verdicts.
 */

import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import type { ToolResponse } from '@server/types';
import { parseStringArg, pathExists } from '@server/domains/platform/handlers/platform-utils';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { parseAsarBuffer } from '@server/domains/platform/handlers/electron-asar-helpers';

const INTEGRITY_KEY = 'ElectronAsarIntegrity';
const MAX_SCAN_BYTES = 64 * 1024 * 1024; // 64 MiB cap to bound binary scans
const SUPPORTED_HASH_ALGORITHMS: ReadonlyMap<string, string> = new Map([
  ['SHA256', 'sha256'],
  ['SHA512', 'sha512'],
]);

export interface AsarIntegrityEntry {
  algorithm: string;
  /** Base64-encoded hash embedded in the binary. */
  hash: string;
}

export interface IntegrityVerification {
  modulePath: string;
  asarPath: string | null;
  embeddedAlgorithm: string;
  embeddedHash: string;
  /** Declared-algorithm hash of the ASAR header content. */
  computedHash: string | null;
  /** Declared-algorithm hash of the full ASAR file (fallback region). */
  computedFullFileHash: string | null;
  verdict:
    | 'verified'
    | 'mismatch'
    | 'asar-not-found'
    | 'header-unparsable'
    | 'unsupported-algorithm';
  note?: string;
}

export async function handleElectronVerifyIntegrity(
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  return handleSafe(async () => {
    const exePath = parseStringArg(args, 'exePath', true);
    if (!exePath) {
      throw new Error('exePath is required');
    }
    if (!(await pathExists(exePath))) {
      return { success: false, error: `File does not exist: ${exePath}` };
    }

    const explicitAsarPath = parseStringArg(args, 'asarPath');

    const buffer = await readFile(exePath);
    const integrityJson = extractIntegrityJson(buffer);

    if (integrityJson === null) {
      return {
        exePath,
        integrityEmbedded: false,
        entries: [],
        verifiedCount: 0,
        mismatchCount: 0,
        note:
          'No ElectronAsarIntegrity JSON found in the binary. The app was either ' +
          'built with an Electron version that omits ASAR integrity, or the ' +
          'EnableEmbeddedAsarIntegrityValidation fuse is disabled.',
      };
    }

    const entries = parseIntegrityEntries(integrityJson);
    if (entries.length === 0) {
      return {
        exePath,
        integrityEmbedded: true,
        rawIntegrityJson: integrityJson,
        entries: [],
        verifiedCount: 0,
        mismatchCount: 0,
        note: 'Integrity JSON was found but contains no ASAR entries.',
      };
    }

    const exeDir = dirname(resolve(exePath));
    const verifications: IntegrityVerification[] = [];

    for (const [modulePath, entry] of entries) {
      const asarPath = explicitAsarPath ?? (await resolveAsarPath(exeDir, modulePath, args));
      const verification = await verifyEntry(modulePath, asarPath, entry);
      verifications.push(verification);
    }

    const verifiedCount = verifications.filter((v) => v.verdict === 'verified').length;
    const mismatchCount = verifications.filter((v) => v.verdict === 'mismatch').length;
    const unsupportedAlgorithmCount = verifications.filter(
      (v) => v.verdict === 'unsupported-algorithm',
    ).length;

    return {
      exePath,
      integrityEmbedded: true,
      rawIntegrityJson: integrityJson,
      entries: verifications,
      verifiedCount,
      mismatchCount,
      unsupportedAlgorithmCount,
      overallVerdict:
        mismatchCount > 0
          ? 'tamper-detected'
          : verifiedCount > 0 && unsupportedAlgorithmCount === 0
            ? 'verified'
            : 'inconclusive',
    };
  });
}

/**
 * Scan the binary for the `ElectronAsarIntegrity` JSON blob. The blob is stored
 * as a raw JSON string in the data section; we locate the key and walk forward
 * to the matching closing brace using balanced brace matching.
 */
function extractIntegrityJson(buffer: Buffer): string | null {
  const scanLimit = Math.min(buffer.length, MAX_SCAN_BYTES);
  const keyBytes = Buffer.from(`"${INTEGRITY_KEY}"`, 'utf8');

  let searchFrom = 0;
  while (searchFrom < scanLimit) {
    const keyIndex = buffer.indexOf(keyBytes, searchFrom);
    if (keyIndex === -1 || keyIndex >= scanLimit) break;

    // The JSON value follows the key + a colon. Walk forward to the opening brace.
    let cursor = keyIndex + keyBytes.length;
    while (cursor < scanLimit) {
      const byte = buffer[cursor];
      if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d || byte === 0x3a) {
        // whitespace or ':'
        cursor += 1;
        continue;
      }
      break;
    }

    if (cursor >= scanLimit || buffer[cursor] !== 0x7b) {
      // Not a JSON object value; keep scanning for the next occurrence.
      searchFrom = keyIndex + keyBytes.length;
      continue;
    }

    const extracted = extractBalancedJson(buffer, cursor, scanLimit);
    if (extracted !== null) {
      return extracted;
    }
    searchFrom = keyIndex + keyBytes.length;
  }

  return null;
}

/** Extract a JSON object starting at `start` (must point at `{`) via brace matching. */
function extractBalancedJson(buffer: Buffer, start: number, limit: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;

  for (let i = start; i < limit; i++) {
    const byte = buffer[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (byte === 0x5c) {
        // backslash
        escaped = true;
      } else if (byte === 0x22) {
        // closing quote
        inString = false;
      }
      continue;
    }
    if (byte === 0x22) {
      inString = true;
      continue;
    }
    if (byte === 0x7b) {
      // {
      depth += 1;
    } else if (byte === 0x7d) {
      // }
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  if (end === -1) return null;
  return buffer.subarray(start, end + 1).toString('utf8');
}

function parseIntegrityEntries(jsonText: string): Array<[string, AsarIntegrityEntry]> {
  let outer: unknown;
  try {
    outer = JSON.parse(jsonText);
  } catch {
    return [];
  }
  if (typeof outer !== 'object' || outer === null) return [];

  // The extracted JSON may be either the full wrapper
  // `{"ElectronAsarIntegrity":{...}}` or just the inner value
  // `{"module/path":{algorithm,hash}}` depending on how the binary stores it.
  const asRecord = outer as Record<string, unknown>;
  const entriesMap = asRecord[INTEGRITY_KEY] ?? outer;

  if (typeof entriesMap !== 'object' || entriesMap === null) return [];

  const entries: Array<[string, AsarIntegrityEntry]> = [];
  for (const [modulePath, rawEntry] of Object.entries(entriesMap as Record<string, unknown>)) {
    if (typeof rawEntry !== 'object' || rawEntry === null) continue;
    const record = rawEntry as Record<string, unknown>;
    const algorithm = typeof record.algorithm === 'string' ? record.algorithm : 'SHA256';
    const hash = typeof record.hash === 'string' ? record.hash : '';
    if (hash.length === 0) continue;
    entries.push([modulePath, { algorithm, hash }]);
  }
  return entries;
}

/**
 * Resolve the on-disk ASAR path for an integrity entry. The module path in the
 * integrity JSON is Electron-internal (e.g. `ElectronAsar.pkg`); we probe a few
 * common locations relative to the exe directory and its resources/ subfolder.
 */
async function resolveAsarPath(
  exeDir: string,
  modulePath: string,
  args: Record<string, unknown>,
): Promise<string | null> {
  const candidates: string[] = [];
  const fileName = modulePath.split('/').pop() ?? modulePath;

  // Common Electron layouts.
  candidates.push(join(exeDir, 'resources', fileName));
  candidates.push(join(exeDir, 'resources', modulePath));
  candidates.push(join(exeDir, fileName));
  candidates.push(join(exeDir, modulePath));
  // macOS .app bundle: exe is in Contents/MacOS/, ASAR in Contents/Resources/
  candidates.push(join(exeDir, '..', 'Resources', fileName));

  for (const candidate of candidates) {
    try {
      const stats = await stat(candidate);
      if (stats.isFile()) return candidate;
    } catch {
      // try next
    }
  }

  void args;
  return null;
}

async function verifyEntry(
  modulePath: string,
  asarPath: string | null,
  entry: AsarIntegrityEntry,
): Promise<IntegrityVerification> {
  if (!asarPath) {
    return {
      modulePath,
      asarPath: null,
      embeddedAlgorithm: entry.algorithm,
      embeddedHash: entry.hash,
      computedHash: null,
      computedFullFileHash: null,
      verdict: 'asar-not-found',
      note: 'ASAR file not found near the executable. Pass asarPath to specify its location.',
    };
  }

  const normalizedAlgorithm = normalizeIntegrityAlgorithm(entry.algorithm);
  const nodeHashAlgorithm = SUPPORTED_HASH_ALGORITHMS.get(normalizedAlgorithm);
  if (!nodeHashAlgorithm) {
    return {
      modulePath,
      asarPath,
      embeddedAlgorithm: entry.algorithm,
      embeddedHash: entry.hash,
      computedHash: null,
      computedFullFileHash: null,
      verdict: 'unsupported-algorithm',
      note:
        `Unsupported ASAR integrity algorithm "${entry.algorithm}". ` +
        `Supported algorithms: ${[...SUPPORTED_HASH_ALGORITHMS.keys()].join(', ')}.`,
    };
  }

  let asarBuffer: Buffer;
  try {
    asarBuffer = await readFile(asarPath);
  } catch (error) {
    return {
      modulePath,
      asarPath,
      embeddedAlgorithm: entry.algorithm,
      embeddedHash: entry.hash,
      computedHash: null,
      computedFullFileHash: null,
      verdict: 'asar-not-found',
      note: `Failed to read ASAR: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const computedFullFileHash = hashBase64(asarBuffer, nodeHashAlgorithm);

  let parsedAsar;
  try {
    parsedAsar = parseAsarBuffer(asarBuffer);
  } catch (error) {
    return {
      modulePath,
      asarPath,
      embeddedAlgorithm: entry.algorithm,
      embeddedHash: entry.hash,
      computedHash: null,
      computedFullFileHash,
      verdict: 'header-unparsable',
      note: `Failed to parse ASAR header: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // Electron hashes the ASAR header content region. The ASAR layout is:
  //   bytes 0-3:   uint32 LE headerSize (pickle outer)
  //   bytes 4-7:   uint32 LE headerStringSize (pickle inner)
  //   bytes 8-11:  uint32 LE headerContentSize (string length)
  //   bytes 12-15: uint32 LE padding
  //   bytes 16..:  header JSON text
  // Electron's @electron/asar computes the integrity hash over the header
  // pickle (bytes 8..8+headerStringSize). We probe both the pickle region and
  // the raw JSON text to tolerate Electron version differences.
  const pickleStart = 8;
  const pickleEnd = pickleStart + parsedAsar.headerStringSize;
  const jsonStart = 16;
  const jsonEnd = jsonStart + parsedAsar.headerContentSize;

  const candidateHashes: Array<{ label: string; hash: string }> = [];
  if (pickleEnd > pickleStart && pickleEnd <= asarBuffer.length) {
    candidateHashes.push({
      label: 'header-pickle',
      hash: hashBase64(asarBuffer.subarray(pickleStart, pickleEnd), nodeHashAlgorithm),
    });
  }
  if (jsonEnd > jsonStart && jsonEnd <= asarBuffer.length) {
    candidateHashes.push({
      label: 'header-json',
      hash: hashBase64(asarBuffer.subarray(jsonStart, jsonEnd), nodeHashAlgorithm),
    });
  }
  candidateHashes.push({ label: 'full-file', hash: computedFullFileHash });

  const matchedRegion = candidateHashes.find((candidate) => candidate.hash === entry.hash);
  const primaryComputed = candidateHashes[0]?.hash ?? null;

  return {
    modulePath,
    asarPath,
    embeddedAlgorithm: entry.algorithm,
    embeddedHash: entry.hash,
    computedHash: primaryComputed,
    computedFullFileHash,
    verdict: matchedRegion ? 'verified' : 'mismatch',
    note: matchedRegion
      ? `${normalizedAlgorithm} header hash matches embedded value (region: ${matchedRegion.label}). ASAR is untampered.`
      : `${normalizedAlgorithm} embedded hash does not match any computed region — ASAR header was modified after build (tamper detected), or the ASAR was replaced.`,
  };
}

function normalizeIntegrityAlgorithm(algorithm: string): string {
  return algorithm.trim().toUpperCase().replace(/[-_]/g, '');
}

function hashBase64(buffer: Buffer, algorithm: string): string {
  return createHash(algorithm).update(buffer).digest('base64');
}
