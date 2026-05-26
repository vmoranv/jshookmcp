/**
 * ObjectPoolDumper — static read-only dump of the Dart isolate snapshot
 * ObjectPool array inside a Flutter AOT `libapp.so`.
 *
 * In Dart AOT, every compile-time constant (string literal, integer,
 * double, class reference, function descriptor) is parked in a single
 * runtime structure called `ObjectPool`. At runtime the `PP` register
 * (x27 on arm64) holds the pool base; `LDR Xn, [PP, #imm]` loads the
 * slot. Statically dumping the pool means:
 *
 *  1. Locate the snapshot header via {@link SnapshotFingerprint}
 *  2. Pick a cluster grammar from {@link selectGrammar}
 *  3. Iterate aligned little-endian words after the pool header
 *  4. For each word:
 *      - low bit 0 → Smi, decoded as `raw >> 1` with sign extension
 *      - low bit 1 → heap pointer; resolve to a class id (cid) and
 *        classify (string / mint / double / pool / null / classRef /
 *        functionRef). Anything outside the snapshot bounds or with an
 *        unknown cid is emitted as `kind: 'unknown'` with the raw bytes.
 *
 * Best-effort approximation: locating the exact ObjectPool object
 * requires SDK-specific cluster-walk logic. This module deliberately
 * uses a simpler bounded sweep: starting at the snapshot header plus
 * the grammar's `poolHeaderSize`, it scans up to `maxSlots * pointerSize`
 * bytes. The resulting slots have stable structure and decoded values;
 * the absolute slot indices may differ from a full Blutter-class
 * cluster walker. This trade-off is explicit per the design doc.
 *
 * Read-only. No APK mutation, no subprocess, no network, no payload,
 * no Dart VM bootstrap. References:
 *  - Phrack #71 (Aug 2024) — Reversing Dart AOT Snapshots
 *  - `darter` / `unflutter` static parsers (cited only as design refs;
 *     no code or data is imported, re-implemented, or vendored)
 */

import { open, stat } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';

import {
  DART_PP_MAX_DUMP_DURATION_MS,
  DART_PP_MAX_SLOTS,
  DART_PP_PREVIEW_BYTES,
  DART_SNAPSHOT_MAX_FILE_BYTES,
} from '@src/constants';
import { ToolError } from '@errors/ToolError';

import { GRAMMARS, selectGrammar, type ClusterGrammar } from './cluster-grammar';
import type {
  DumpOptions,
  DumpResult,
  ObjectPoolSlot,
  ObjectPoolSlotConfidence,
  ObjectPoolSlotKind,
} from './pool-types';
import { SnapshotFingerprint } from './SnapshotFingerprint';
import type { VersionFingerprint } from './snapshot-types';

/** Minimum bytes we need after the pool header to even try decoding a slot. */
const MIN_SLOT_BYTES = 4;

/** Header bits per cid. Dart packs the class id in the low bits of header word. */
const CID_MASK = 0xffff;

/** Hex-encode an LE word for `rawBytes` reporting. */
function wordToHex(buf: Buffer, offset: number, width: 4 | 8): string {
  return buf.subarray(offset, offset + width).toString('hex');
}

/** Decode a Smi value from an aligned word. Returns `undefined` if the word
 * is a pointer (low bit set). */
function decodeSmi(buf: Buffer, offset: number, width: 4 | 8): number | undefined {
  if (width === 4) {
    const raw = buf.readUInt32LE(offset);
    if ((raw & 1) !== 0) return undefined;
    return (raw | 0) >> 1; // sign-extend then arithmetic shift
  }
  const raw = buf.readBigUInt64LE(offset);
  if ((raw & 1n) !== 0n) return undefined;
  const signed = BigInt.asIntN(64, raw) >> 1n;
  if (signed > BigInt(Number.MAX_SAFE_INTEGER) || signed < BigInt(Number.MIN_SAFE_INTEGER)) {
    return undefined;
  }
  return Number(signed);
}

/** Resolve a tagged pointer to a candidate file offset. */
function pointerToOffset(buf: Buffer, offset: number, width: 4 | 8): number | undefined {
  if (width === 4) {
    const raw = buf.readUInt32LE(offset);
    if ((raw & 1) === 0) return undefined;
    return raw - 1;
  }
  const raw = buf.readBigUInt64LE(offset);
  if ((raw & 1n) === 0n) return undefined;
  const untagged = raw - 1n;
  if (untagged > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
  return Number(untagged);
}

/** Map a class id to a slot kind via the grammar's `knownCids`. */
function classifyCid(cid: number, grammar: ClusterGrammar): ObjectPoolSlotKind | undefined {
  const m = grammar.knownCids;
  if (cid === m['oneByteString'] || cid === m['twoByteString']) return 'string';
  if (cid === m['mint']) return 'mint';
  if (cid === m['double']) return 'double';
  if (cid === m['objectPool']) return 'pool';
  if (cid === m['null']) return 'null';
  if (cid === m['classRef']) return 'classRef';
  if (cid === m['functionRef']) return 'functionRef';
  return undefined;
}

/**
 * Read a single object header word at `targetOffset` and return the
 * cid. Returns `undefined` if `targetOffset` is out-of-bounds.
 */
function readCid(snapshot: Buffer, targetOffset: number): number | undefined {
  if (targetOffset < 0 || targetOffset + 4 > snapshot.length) return undefined;
  const header = snapshot.readUInt32LE(targetOffset);
  return header & CID_MASK;
}

/**
 * Decode the preview for a string-like slot. Reads up to `previewBytes`
 * after a small string-header offset; falls back to hex when the bytes
 * are non-printable.
 */
/** True when every code unit of `s` is printable ASCII (0x20..0x7e). */
function isPrintableAscii(s: string): boolean {
  if (s.length === 0) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c > 0x7e) return false;
  }
  return true;
}

/** Strip trailing NUL code units from `s`. */
function stripTrailingNul(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 0) end -= 1;
  return s.slice(0, end);
}

function decodeStringPreview(
  snapshot: Buffer,
  targetOffset: number,
  previewBytes: number,
  twoByte: boolean,
): string | undefined {
  for (const headerSize of [8, 12, 16]) {
    const start = targetOffset + headerSize;
    if (start < 0 || start >= snapshot.length) continue;
    const end = Math.min(start + previewBytes, snapshot.length);
    const slice = snapshot.subarray(start, end);
    if (slice.length === 0) continue;
    if (twoByte) {
      const decoded = stripTrailingNul(slice.toString('utf16le'));
      if (isPrintableAscii(decoded)) {
        return decoded.slice(0, Math.floor(previewBytes / 2));
      }
    } else {
      const ascii = stripTrailingNul(slice.toString('latin1'));
      if (isPrintableAscii(ascii)) {
        return ascii.slice(0, previewBytes);
      }
    }
  }
  return undefined;
}

/** Decode a 64-bit mint preview from the target. */
function decodeMintPreview(snapshot: Buffer, targetOffset: number): string | undefined {
  // Mint object has a header then an 8-byte int64. Try a couple of offsets.
  for (const headerSize of [8, 16]) {
    const start = targetOffset + headerSize;
    if (start < 0 || start + 8 > snapshot.length) continue;
    const value = BigInt.asIntN(64, snapshot.readBigUInt64LE(start));
    return value.toString();
  }
  return undefined;
}

/** Decode a double preview (IEEE-754) from the target. */
function decodeDoublePreview(snapshot: Buffer, targetOffset: number): string | undefined {
  for (const headerSize of [8, 16]) {
    const start = targetOffset + headerSize;
    if (start < 0 || start + 8 > snapshot.length) continue;
    const value = snapshot.readDoubleLE(start);
    if (Number.isFinite(value)) return value.toString();
    return value.toString();
  }
  return undefined;
}

export class ObjectPoolDumper {
  private readonly fingerprintProbe: SnapshotFingerprint;

  constructor(fingerprintProbe: SnapshotFingerprint = new SnapshotFingerprint()) {
    this.fingerprintProbe = fingerprintProbe;
  }

  /**
   * Dump the ObjectPool slots from a Flutter `libapp.so`.
   *
   * Error model:
   *  - `VALIDATION` — empty path, non-positive `maxSlots`, negative `previewBytes`
   *  - `NOT_FOUND`  — file does not exist
   *  - `PERMISSION` — file exceeds `DART_SNAPSHOT_MAX_FILE_BYTES`
   *  - `TIMEOUT`    — decode wall-clock exceeded `DART_PP_MAX_DUMP_DURATION_MS`
   *
   * Grammar mismatch is **not** an error: the method returns a result
   * with `grammar.matched: false` and empty slots.
   */
  async dump(filePath: string, opts: DumpOptions = {}): Promise<DumpResult> {
    if (!filePath || filePath.length === 0) {
      throw new ToolError('VALIDATION', 'filePath must be a non-empty string');
    }
    const maxSlots = opts.maxSlots ?? DART_PP_MAX_SLOTS;
    if (!Number.isFinite(maxSlots) || maxSlots <= 0) {
      throw new ToolError('VALIDATION', `maxSlots must be a positive integer (got ${maxSlots})`);
    }
    const previewBytes = opts.previewBytes ?? DART_PP_PREVIEW_BYTES;
    if (!Number.isFinite(previewBytes) || previewBytes < 0) {
      throw new ToolError(
        'VALIDATION',
        `previewBytes must be a non-negative integer (got ${previewBytes})`,
      );
    }

    let fileSize: number;
    try {
      const st = await stat(filePath);
      fileSize = st.size;
    } catch (cause) {
      throw new ToolError('NOT_FOUND', `File not found: ${filePath}`, {
        details: { filePath },
        cause: cause as Error,
      });
    }
    if (fileSize > DART_SNAPSHOT_MAX_FILE_BYTES) {
      throw new ToolError(
        'PERMISSION',
        `File ${filePath} exceeds DART_SNAPSHOT_MAX_FILE_BYTES (${fileSize} > ${DART_SNAPSHOT_MAX_FILE_BYTES})`,
        { details: { filePath, fileSize, limit: DART_SNAPSHOT_MAX_FILE_BYTES } },
      );
    }

    const startedAt = performance.now();
    const checkBudget = (): void => {
      if (performance.now() - startedAt > DART_PP_MAX_DUMP_DURATION_MS) {
        throw new ToolError(
          'TIMEOUT',
          `dart_object_pool_dump exceeded DART_PP_MAX_DUMP_DURATION_MS (${DART_PP_MAX_DUMP_DURATION_MS}ms)`,
        );
      }
    };

    // 1. Fingerprint — either supplied or freshly parsed.
    const fingerprint = opts.fingerprint ?? (await this.fingerprintProbe.fingerprint(filePath));
    checkBudget();

    // 2. Pick a grammar. Mismatch → structured empty result, no throw.
    const grammar = this.pickGrammar(fingerprint, opts.grammar);
    if (!grammar) {
      return {
        pool: { fileOffset: -1, slotCount: 0, pointerSize: 0 },
        grammar: { sdkFamily: 'unknown', matched: false },
        slots: [],
        truncated: false,
        unknownSlotCount: 0,
      };
    }

    // 3. Locate the snapshot region. If we can not, surface an empty
    //    result with the matched grammar so callers can still see which
    //    family was selected.
    const headerOffset = fingerprint.fileOffset;
    if (headerOffset < 0) {
      return {
        pool: { fileOffset: -1, slotCount: 0, pointerSize: grammar.pointerSize },
        grammar: { sdkFamily: grammar.sdkFamily, matched: true },
        slots: [],
        truncated: false,
        unknownSlotCount: 0,
      };
    }

    // 4. Best-effort: read the whole file into a buffer so we can both
    //    iterate slot words and dereference pointer slots without
    //    repeated I/O. We then compute the slot region start as the
    //    end of the snapshot header (magic + kind + hash + NUL-
    //    terminated features) plus the grammar's `poolHeaderSize`
    //    preamble. This skips the variable-length snapshot header so
    //    fixtures and real binaries see the same offset arithmetic.
    const snapshotBuf = await this.readRegion(filePath, 0, fileSize);
    checkBudget();

    const snapshotHeaderEnd = this.computeSnapshotHeaderEnd(snapshotBuf, headerOffset);
    const slotRegionStart = snapshotHeaderEnd + grammar.poolHeaderSize;
    const slotRegionEnd = Math.min(
      fileSize,
      slotRegionStart + maxSlots * (grammar.pointerSize + grammar.perSlotPrefixSize),
    );
    if (slotRegionStart >= fileSize || slotRegionEnd - slotRegionStart < MIN_SLOT_BYTES) {
      return {
        pool: { fileOffset: headerOffset, slotCount: 0, pointerSize: grammar.pointerSize },
        grammar: { sdkFamily: grammar.sdkFamily, matched: true },
        slots: [],
        truncated: false,
        unknownSlotCount: 0,
      };
    }

    // 5. Iterate slots.
    const slots: ObjectPoolSlot[] = [];
    let truncated = false;
    let unknownSlotCount = 0;
    const stride = grammar.pointerSize + grammar.perSlotPrefixSize;

    for (let slotIndex = 0; slotIndex < maxSlots; slotIndex++) {
      checkBudget();
      const absOffset = slotRegionStart + slotIndex * stride;
      if (absOffset + grammar.pointerSize > slotRegionEnd) {
        break;
      }
      const wordOffset = absOffset + grammar.perSlotPrefixSize;
      const slot = this.decodeSlot(snapshotBuf, slotIndex, wordOffset, grammar, previewBytes);
      slots.push(slot);
      if (slot.kind === 'unknown') unknownSlotCount += 1;
    }

    if (slots.length >= maxSlots && slotRegionStart + maxSlots * stride < fileSize) {
      // There were more bytes available but we capped at maxSlots.
      truncated = true;
    }

    return {
      pool: {
        fileOffset: headerOffset,
        slotCount: slots.length,
        pointerSize: grammar.pointerSize,
      },
      grammar: { sdkFamily: grammar.sdkFamily, matched: true },
      slots,
      truncated,
      unknownSlotCount,
    };
  }

  /** Pick the grammar for this dump (force-override → fingerprint → undefined). */
  private pickGrammar(
    fingerprint: VersionFingerprint,
    forceGrammar?: string,
  ): ClusterGrammar | undefined {
    if (forceGrammar) {
      const forced = GRAMMARS.find((g) => g.sdkFamily === forceGrammar);
      if (forced) return forced;
    }
    return selectGrammar({
      flutterVersion: fingerprint.flutterVersion,
      dartSdkRev: fingerprint.dartSdkRev,
      targetArch: fingerprint.targetArch,
    });
  }

  /**
   * Compute the absolute file offset just past the snapshot header
   * (magic + kind + 32-byte hash + NUL-terminated features). The
   * NUL-terminator search is bounded so we never run away on a
   * non-Dart byte sequence.
   */
  private computeSnapshotHeaderEnd(snapshot: Buffer, headerOffset: number): number {
    const featuresStart = headerOffset + 0x28;
    if (featuresStart >= snapshot.length) {
      return featuresStart;
    }
    // Bound the search at 4 KiB — matches the probe length used by SnapshotFingerprint.
    const featuresEnd = Math.min(featuresStart + 4096, snapshot.length);
    let nul = snapshot.indexOf(0, featuresStart);
    if (nul < 0 || nul >= featuresEnd) nul = featuresEnd - 1;
    return nul + 1;
  }

  /** Decode a single slot at `wordOffset`. */
  private decodeSlot(
    snapshot: Buffer,
    slotIndex: number,
    wordOffset: number,
    grammar: ClusterGrammar,
    previewBytes: number,
  ): ObjectPoolSlot {
    const width = grammar.pointerSize;
    if (wordOffset + width > snapshot.length) {
      return {
        slotIndex,
        fileOffset: wordOffset,
        kind: 'unknown',
        rawBytes: '',
        confidence: 'low',
      };
    }

    // Smi case (tag bit 0 = 0)
    const smi = decodeSmi(snapshot, wordOffset, width);
    if (smi !== undefined) {
      return {
        slotIndex,
        fileOffset: wordOffset,
        kind: 'smi',
        preview: smi.toString(),
        confidence: 'high',
      };
    }

    // Pointer case
    const target = pointerToOffset(snapshot, wordOffset, width);
    if (target === undefined || target < 0 || target >= snapshot.length) {
      return {
        slotIndex,
        fileOffset: wordOffset,
        kind: 'unknown',
        rawBytes: wordToHex(snapshot, wordOffset, width),
        confidence: 'low',
      };
    }
    const cid = readCid(snapshot, target);
    if (cid === undefined) {
      return {
        slotIndex,
        fileOffset: wordOffset,
        kind: 'unknown',
        rawBytes: wordToHex(snapshot, wordOffset, width),
        confidence: 'low',
      };
    }
    const kind = classifyCid(cid, grammar);
    if (!kind) {
      return {
        slotIndex,
        fileOffset: wordOffset,
        kind: 'unknown',
        cid,
        rawBytes: wordToHex(snapshot, wordOffset, width),
        confidence: 'low',
      };
    }
    return this.buildClassifiedSlot(
      snapshot,
      slotIndex,
      wordOffset,
      target,
      cid,
      kind,
      grammar,
      previewBytes,
    );
  }

  /** Build a classified-pointer slot result (handles preview decoding). */
  private buildClassifiedSlot(
    snapshot: Buffer,
    slotIndex: number,
    wordOffset: number,
    target: number,
    cid: number,
    kind: ObjectPoolSlotKind,
    grammar: ClusterGrammar,
    previewBytes: number,
  ): ObjectPoolSlot {
    let preview: string | undefined;
    let confidence: ObjectPoolSlotConfidence = 'medium';
    if (kind === 'string') {
      const twoByte = cid === grammar.knownCids['twoByteString'];
      preview = decodeStringPreview(snapshot, target, previewBytes, twoByte);
      if (preview !== undefined) confidence = 'high';
    } else if (kind === 'mint') {
      preview = decodeMintPreview(snapshot, target);
      if (preview !== undefined) confidence = 'high';
    } else if (kind === 'double') {
      preview = decodeDoublePreview(snapshot, target);
      if (preview !== undefined) confidence = 'high';
    } else if (kind === 'null') {
      confidence = 'high';
    } else if (kind === 'pool') {
      confidence = 'medium';
    }
    const slot: ObjectPoolSlot = {
      slotIndex,
      fileOffset: wordOffset,
      kind,
      cid,
      confidence,
    };
    if (preview !== undefined) slot.preview = preview;
    return slot;
  }

  /** Read `[start, end)` of the file into a buffer. */
  private async readRegion(filePath: string, start: number, end: number): Promise<Buffer> {
    const fh = await open(filePath, 'r');
    try {
      const length = Math.max(0, end - start);
      const buf = Buffer.alloc(length);
      if (length > 0) {
        await fh.read(buf, 0, length, start);
      }
      return buf;
    } finally {
      await fh.close();
    }
  }
}
