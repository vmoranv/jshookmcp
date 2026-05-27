/**
 * SigningBlockParser — read-only parser for the APK Signing Block (v2/v3/
 * v3.1/v4) plus heuristic detection of non-standard residue blocks and
 * dex-prefix-anomaly layouts (where a DEX header is prepended to the file
 * so DEX loaders and ZIP loaders disagree on the content).
 *
 * Implementation contract:
 *   - **No payload, no signature regeneration, no APK mutation.** The
 *     parser opens the file read-only, never writes back, never spawns a
 *     subprocess, never invokes any signing CLI.
 *   - Output is a structured `SigningBlockReport` describing what was
 *     found; anomalies are advisory only.
 *   - All numeric thresholds come from `./constants` (env-tunable).
 *
 * References (canonical):
 *   - AOSP v2 spec   https://source.android.com/docs/security/features/apksigning/v2
 *   - AOSP v3 spec   https://source.android.com/docs/security/features/apksigning/v3
 *   - AOSP v4 spec   https://source.android.com/docs/security/features/apksigning/v4
 *   - apksig source  tools/apksig/src/main/java/com/android/apksig/internal/apk/{v2,v3}/
 */

import { createHash } from 'node:crypto';
import { open, stat, type FileHandle } from 'node:fs/promises';

import { ToolError } from '@errors/ToolError';

import {
  APK_PACKER_MAX_APK_BYTES,
  APK_SIGBLOCK_DEX_PREFIX_HEAD_BYTES,
  APK_SIGBLOCK_EOCD_SCAN_BYTES,
  APK_SIGBLOCK_MAX_BYTES,
} from './constants';
import type {
  Anomaly,
  CertificateInfo,
  ProofOfRotation,
  SigAlgorithm,
  SigningBlockReport,
  V2Signer,
  V3Signer,
  V4Block,
} from './signing-block-types';
import {
  APK_SIG_BLOCK_MAGIC,
  BLOCK_ID_PROOF_OF_ROTATION_ATTR,
  BLOCK_ID_SOURCE_STAMP,
  BLOCK_ID_UNKNOWN_RESIDUE,
  BLOCK_ID_V2,
  BLOCK_ID_V3,
  BLOCK_ID_V3_1,
  BLOCK_ID_V4,
  DEX_MAGIC,
  EOCD_SIGNATURE,
} from './signing-block-types';

const SIG_BLOCK_MAGIC_BYTES = Buffer.from(APK_SIG_BLOCK_MAGIC, 'utf8');

interface WriteableSchemes {
  v2?: { signers: V2Signer[] };
  v3?: { signers: V3Signer[]; keyRotation?: ProofOfRotation };
  v3_1?: { signers: V3Signer[] };
  v4?: V4Block;
}

interface ParserState {
  schemes: WriteableSchemes;
  unknownBlocks: Array<{ id: string; size: number }>;
  warnings: string[];
  anomalies: Anomaly[];
}

/** Parser for the APK Signing Block. Stateless — safe to share. */
export class SigningBlockParser {
  /**
   * Parse `apkPath`. Returns a complete `SigningBlockReport` even when
   * the file has no signing block (the `found:false` branch). Throws
   * `ToolError(NOT_FOUND|VALIDATION)` only for unusable input.
   */
  async parse(apkPath: string): Promise<SigningBlockReport> {
    if (!apkPath || typeof apkPath !== 'string') {
      throw new ToolError('VALIDATION', 'apkPath must be a non-empty string');
    }

    let stats;
    try {
      stats = await stat(apkPath);
    } catch (cause) {
      throw new ToolError('NOT_FOUND', `APK not found: ${apkPath}`, {
        details: { apkPath },
        cause: cause as Error,
      });
    }
    if (!stats.isFile()) {
      throw new ToolError('VALIDATION', `Path is not a regular file: ${apkPath}`, {
        details: { apkPath },
      });
    }
    if (stats.size > APK_PACKER_MAX_APK_BYTES) {
      throw new ToolError(
        'VALIDATION',
        `APK exceeds APK_PACKER_MAX_APK_BYTES (${APK_PACKER_MAX_APK_BYTES} bytes): ${stats.size}`,
        { details: { apkPath, size: stats.size, max: APK_PACKER_MAX_APK_BYTES } },
      );
    }

    let fh: FileHandle | undefined;
    try {
      fh = await open(apkPath, 'r');
      return await this.parseHandle(fh, apkPath, stats.size);
    } finally {
      if (fh) await fh.close();
    }
  }

  private async parseHandle(
    fh: FileHandle,
    apkPath: string,
    fileSize: number,
  ): Promise<SigningBlockReport> {
    const state: ParserState = {
      schemes: {},
      unknownBlocks: [],
      warnings: [],
      anomalies: [],
    };

    // 1. Locate EOCD by reverse-scanning the file tail.
    const tailLen = Math.min(APK_SIGBLOCK_EOCD_SCAN_BYTES, fileSize);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, fileSize - tailLen);
    const eocdOffsetInTail = findEOCD(tail);
    if (eocdOffsetInTail < 0) {
      state.anomalies.push({
        kind: 'eocd-not-found',
        evidence: `Scanned trailing ${tailLen} bytes — no EOCD signature 0x06054b50`,
      });
      return buildReport(apkPath, fileSize, state, false);
    }
    const centralDirOffset = tail.readUInt32LE(eocdOffsetInTail + 16);
    const fileEOCDOffset = fileSize - tailLen + eocdOffsetInTail;

    // 2. Validate centralDirOffset is sane.
    if (centralDirOffset >= fileEOCDOffset || centralDirOffset < 24) {
      state.warnings.push(
        `Implausible centralDirOffset ${centralDirOffset} given file size ${fileSize}`,
      );
      return buildReport(apkPath, fileSize, state, false);
    }

    // 3. Read 24 bytes immediately preceding centralDirOffset:
    //    [size_of_block (u64)] [magic (16 B "APK Sig Block 42")].
    const trailer = Buffer.alloc(24);
    await fh.read(trailer, 0, 24, centralDirOffset - 24);
    const magicCandidate = trailer.subarray(8);

    if (!magicCandidate.equals(SIG_BLOCK_MAGIC_BYTES)) {
      // Magic missing at the canonical position — try a small scan.
      const scanWindow = Math.min(centralDirOffset, APK_SIGBLOCK_EOCD_SCAN_BYTES);
      const scanBuf = Buffer.alloc(scanWindow);
      await fh.read(scanBuf, 0, scanWindow, centralDirOffset - scanWindow);
      const at = scanBuf.indexOf(SIG_BLOCK_MAGIC_BYTES);
      if (at < 0) {
        // No signing block — legitimate (v1-only) or stripped.
        return buildReport(apkPath, fileSize, state, false);
      }
      const delta = scanWindow - (at + SIG_BLOCK_MAGIC_BYTES.length);
      state.anomalies.push({
        kind: 'magic-offset',
        evidence: `APK Sig Block 42 magic located ${delta} bytes before expected position`,
      });
      // Don't try to parse the body if the layout is corrupt — bail with the anomaly.
      return buildReport(apkPath, fileSize, state, false);
    }

    // Magic confirmed — only now is the u64 size field meaningful. Read it
    // defensively so malformed blocks don't crash the parser.
    let sizeOfBlock: number;
    try {
      sizeOfBlock = readU64LEAsNumber(trailer, 0);
    } catch (err) {
      state.warnings.push(`Signing block size field unreadable: ${(err as Error).message}`);
      return buildReport(apkPath, fileSize, state, false);
    }

    if (sizeOfBlock <= 0 || sizeOfBlock > APK_SIGBLOCK_MAX_BYTES) {
      state.warnings.push(
        `Signing block size ${sizeOfBlock} outside [1, ${APK_SIGBLOCK_MAX_BYTES}] — refusing to read`,
      );
      return buildReport(apkPath, fileSize, state, false);
    }
    // 4. The signing block is: [size_of_block (u64)] | ID-value pairs |
    //    [size_of_block (u64)] [magic (16 B)]. Total length = 8 + sizeOfBlock.
    // The "sizeOfBlock" stored at both ends covers everything except the
    // leading 8-byte size field, so the absolute block start is at
    // (centralDirOffset - sizeOfBlock - 8).
    const blockStartOffset = centralDirOffset - sizeOfBlock - 8;
    if (blockStartOffset < 0) {
      state.warnings.push('Computed signing block start offset is negative — refusing to read');
      return buildReport(apkPath, fileSize, state, false);
    }
    const totalLen = sizeOfBlock + 8;
    if (totalLen > APK_SIGBLOCK_MAX_BYTES) {
      state.warnings.push(
        `Signing block total length ${totalLen} exceeds APK_SIGBLOCK_MAX_BYTES — refusing to read`,
      );
      return buildReport(apkPath, fileSize, state, false);
    }
    const block = Buffer.alloc(Number(totalLen));
    await fh.read(block, 0, Number(totalLen), blockStartOffset);

    // 5. Parse ID-value pairs.
    parseIdValuePairs(block, state);

    // 6. DEX-prefix heuristic — scan first APK_SIGBLOCK_DEX_PREFIX_HEAD_BYTES bytes for DEX magic.
    if (fileSize >= 4) {
      const headLen = Math.min(APK_SIGBLOCK_DEX_PREFIX_HEAD_BYTES, fileSize);
      const head = Buffer.alloc(headLen);
      await fh.read(head, 0, headLen, 0);
      // DEX magic at offset 0 means the file is ambiguous to readers.
      if (head.length >= 4 && head.readUInt32BE(0) === DEX_MAGIC) {
        state.anomalies.push({
          kind: 'dex-prefix-anomaly',
          evidence:
            'DEX magic (0x6465780a) at file head with a valid Signing Block — possible dex-prefix injection pattern',
        });
      }
    }

    return buildReport(apkPath, fileSize, state, true, {
      magic: APK_SIG_BLOCK_MAGIC,
      size: Number(totalLen),
      offset: blockStartOffset,
    });
  }
}

// ── helpers ──

function buildReport(
  apkPath: string,
  fileSize: number,
  state: ParserState,
  found: boolean,
  meta?: { magic: string; size: number; offset: number },
): SigningBlockReport {
  const signingBlock =
    found && meta
      ? { found: true, magic: meta.magic, size: meta.size, offset: meta.offset }
      : { found: false };
  return {
    apkPath,
    fileSize,
    signingBlock,
    schemes: state.schemes,
    unknownBlocks: state.unknownBlocks,
    warnings: state.warnings,
    anomalies: state.anomalies,
  };
}

/** Reverse-scan the tail buffer for the EOCD signature. Returns offset or -1. */
function findEOCD(tail: Buffer): number {
  // EOCD record is 22 bytes minimum (no comment). Magic at the start.
  if (tail.length < 22) return -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD_SIGNATURE) {
      // Validate commentLength field (last 2 bytes) matches remaining buffer.
      const commentLen = tail.readUInt16LE(i + 20);
      if (i + 22 + commentLen === tail.length) {
        return i;
      }
    }
  }
  return -1;
}

/** Iterate ID-value pairs inside the Signing Block payload. */
function parseIdValuePairs(block: Buffer, state: ParserState): void {
  // Skip leading 8-byte size field at block[0..8] and trailing
  // size + magic at block[totalLen-24..]. Payload is block[8..totalLen-24].
  const payloadStart = 8;
  const payloadEnd = block.length - 24;
  let cursor = payloadStart;
  while (cursor + 12 <= payloadEnd) {
    const pairSize = readU64LEAsNumber(block, cursor);
    if (pairSize < 4 || cursor + 8 + pairSize > payloadEnd) {
      state.warnings.push(`Truncated ID-value pair at offset ${cursor} (pairSize ${pairSize})`);
      return;
    }
    const id = block.readUInt32LE(cursor + 8);
    const valueStart = cursor + 12;
    const valueEnd = cursor + 8 + pairSize;
    const value = block.subarray(valueStart, valueEnd);
    dispatchBlock(id, value, state);
    cursor = valueEnd;
  }
}

function dispatchBlock(id: number, value: Buffer, state: ParserState): void {
  switch (id) {
    case BLOCK_ID_V2: {
      const signers = parseV2OrV3Signers(value, /* isV3 */ false, state) as V2Signer[];
      if (state.schemes.v2) {
        state.anomalies.push({
          kind: 'duplicate-scheme',
          evidence: 'v2 signers block (0x7109871a) appears more than once',
        });
        state.schemes.v2.signers.push(...signers);
      } else {
        state.schemes.v2 = { signers };
      }
      return;
    }
    case BLOCK_ID_V3: {
      const signers = parseV2OrV3Signers(value, /* isV3 */ true, state) as V3Signer[];
      const keyRotation = collectProofOfRotation(signers);
      state.schemes.v3 = keyRotation ? { signers, keyRotation } : { signers };
      return;
    }
    case BLOCK_ID_V3_1: {
      const signers = parseV2OrV3Signers(value, /* isV3 */ true, state) as V3Signer[];
      state.schemes.v3_1 = { signers };
      return;
    }
    case BLOCK_ID_V4: {
      const v4 = parseV4Block(value);
      if (v4) state.schemes.v4 = v4;
      return;
    }
    case BLOCK_ID_SOURCE_STAMP:
      // We recognize but don't decode the source-stamp block — record as known.
      return;
    case BLOCK_ID_UNKNOWN_RESIDUE: {
      state.unknownBlocks.push({ id: toHexId(id), size: value.length });
      state.anomalies.push({
        kind: 'extra-block-anomaly',
        evidence: `Block ID 0x42424242 present (size=${value.length}) — non-standard residue marker`,
      });
      state.warnings.push(
        'Unknown block 0x42424242 detected — non-standard block ID observed in some legacy tooling. Manual review recommended.',
      );
      return;
    }
    default:
      state.unknownBlocks.push({ id: toHexId(id), size: value.length });
      state.anomalies.push({
        kind: 'extra-block',
        evidence: `Unknown block id ${toHexId(id)} size=${value.length}`,
      });
      return;
  }
}

/**
 * Parse a v2 or v3 signers payload. The two layouts share the same
 * length-prefixed sequence-of-signers structure; v3 signedData additionally
 * carries minSdkVersion / maxSdkVersion at the start.
 */
function parseV2OrV3Signers(
  value: Buffer,
  isV3: boolean,
  state: ParserState,
): V2Signer[] | V3Signer[] {
  const reader = new LengthReader(value, 'signers');
  const signersLen = reader.readU32();
  if (signersLen === 0) return [];
  const signersBuf = reader.readSlice(signersLen, 'signersBuf');

  const signers: (V2Signer | V3Signer)[] = [];
  const signersReader = new LengthReader(signersBuf, 'signers-inner');
  while (signersReader.remaining() > 0) {
    const signerLen = signersReader.readU32();
    const signerBuf = signersReader.readSlice(signerLen, 'signer');
    try {
      signers.push(parseSingleSigner(signerBuf, isV3));
    } catch (err) {
      state.warnings.push(`Skipped malformed signer: ${(err as Error).message}`);
    }
  }
  return signers as V2Signer[] | V3Signer[];
}

function parseSingleSigner(signerBuf: Buffer, isV3: boolean): V2Signer | V3Signer {
  const r = new LengthReader(signerBuf, 'signer');
  const signedDataLen = r.readU32();
  const signedData = r.readSlice(signedDataLen, 'signedData');

  let minSdk = 0;
  let maxSdk = 0;
  if (isV3) {
    // v3 layout: signedData is followed by 2 x u32 (minSDK, maxSDK), then
    // signatures + publicKey. apksig writes minSDK/maxSDK at the *outer*
    // signer level (after signedData), per V3SchemeVerifier#parseSigner.
    minSdk = r.readU32();
    maxSdk = r.readU32();
  }

  const sigsLen = r.readU32();
  const sigsBuf = r.readSlice(sigsLen, 'signatures');
  const signatures: V2Signer['signatures'][number][] = [];
  const sigsReader = new LengthReader(sigsBuf, 'signatures-inner');
  while (sigsReader.remaining() > 0) {
    const oneLen = sigsReader.readU32();
    const oneBuf = sigsReader.readSlice(oneLen, 'signature');
    if (oneBuf.length < 4) continue;
    const algId = oneBuf.readUInt32LE(0);
    signatures.push({ algorithm: mapAlgorithmId(algId), algorithmId: algId });
  }

  // signedData inner layout: digests | certificates | additionalAttributes.
  const sd = new LengthReader(signedData, 'signedData');
  const digestsLen = sd.readU32();
  const digestsBuf = sd.readSlice(digestsLen, 'digests');
  const digests: V2Signer['digests'][number][] = [];
  const digestsReader = new LengthReader(digestsBuf, 'digests-inner');
  while (digestsReader.remaining() > 0) {
    const oneLen = digestsReader.readU32();
    const oneBuf = digestsReader.readSlice(oneLen, 'digest');
    if (oneBuf.length < 4) continue;
    const algId = oneBuf.readUInt32LE(0);
    digests.push({ algorithm: mapAlgorithmId(algId), algorithmId: algId });
  }

  const certsLen = sd.readU32();
  const certsBuf = sd.readSlice(certsLen, 'certificates');
  const certificates: CertificateInfo[] = [];
  const certsReader = new LengthReader(certsBuf, 'certs-inner');
  while (certsReader.remaining() > 0) {
    const oneLen = certsReader.readU32();
    const oneBuf = certsReader.readSlice(oneLen, 'certificate');
    certificates.push(fingerprintCert(oneBuf));
  }

  const attrsLen = sd.readU32();
  const attrsBuf = sd.readSlice(attrsLen, 'attributes');
  const additionalAttributes: V2Signer['additionalAttributes'][number][] = [];
  const attrsReader = new LengthReader(attrsBuf, 'attrs-inner');
  while (attrsReader.remaining() > 0) {
    const oneLen = attrsReader.readU32();
    const oneBuf = attrsReader.readSlice(oneLen, 'attribute');
    if (oneBuf.length < 4) continue;
    const attrId = oneBuf.readUInt32LE(0);
    additionalAttributes.push({ id: toHexId(attrId), size: oneBuf.length });
  }

  const base: V2Signer = {
    digests,
    signatures,
    certificates,
    additionalAttributes,
  };
  if (isV3) {
    const v3: V3Signer = {
      ...base,
      minSdkVersion: minSdk,
      maxSdkVersion: maxSdk,
    };
    return v3;
  }
  return base;
}

/**
 * Locate `proofOfRotation` attribute(s) inside the given v3 signers and
 * decode the lineage. The attribute payload starts with a u32 attribute
 * id (which we've already stripped during attribute enumeration in
 * `parseSingleSigner`, but we need raw access here). To avoid keeping the
 * raw buffer around we re-scan signedData when we know a candidate exists.
 *
 * Simplification: for now we treat the *first* v3 signer's first PoR
 * attribute as the lineage source. apksig itself follows the same
 * convention because all signers in a v3 block share lineage.
 *
 * We need the raw signedData to actually parse — store the cached attrs
 * buffer alongside the V3Signer at parse time. For now we return undefined
 * if the attribute size is the only thing we kept (caller falls back to
 * a missing lineage which is still a valid report).
 */
function collectProofOfRotation(signers: ReadonlyArray<V3Signer>): ProofOfRotation | undefined {
  // We only declared size; full parsing requires raw bytes. Persist a
  // best-effort proof signal: the *presence* of the PoR attribute id
  // among signedData attrs.
  for (const s of signers) {
    for (const a of s.additionalAttributes) {
      if (a.id === toHexId(BLOCK_ID_PROOF_OF_ROTATION_ATTR)) {
        // We don't have the raw bytes here. Return an empty-levels marker
        // so the report shows `keyRotation: { levels: [] }` — analysts
        // know a lineage exists and can drop down to an external signing
        // CLI if they need the full chain. This avoids carrying raw byte
        // buffers through the report (and keeps the JSON small).
        return { levels: [] };
      }
    }
  }
  return undefined;
}

/**
 * Parse a v4 block. The on-disk shape varies by AOSP version; we read the
 * conservative subset: u32 algorithm id + u32 root-hash length + hash +
 * u32 tree size length + u64 tree size (best-effort).
 */
function parseV4Block(value: Buffer): V4Block | undefined {
  try {
    const r = new LengthReader(value, 'v4');
    const algId = r.readU32();
    const hashLen = r.readU32();
    const hash = r.readSlice(hashLen, 'v4-hash');
    let treeSize = 0;
    if (r.remaining() >= 8) {
      treeSize = readU64LEAsNumber(value, r.position());
    } else if (r.remaining() >= 4) {
      treeSize = r.readU32();
    }
    return {
      algorithm: mapAlgorithmId(algId),
      rootHash: hash.toString('hex'),
      treeSize,
    };
  } catch {
    return undefined;
  }
}

/** Compute SHA-256 over a DER-encoded certificate. */
function fingerprintCert(der: Buffer): CertificateInfo {
  const sha = createHash('sha256').update(der).digest('hex');
  const preview = der.subarray(0, Math.min(32, der.length)).toString('hex');
  return {
    sha256Fingerprint: sha,
    derLength: der.length,
    derPreview: preview,
  };
}

/** Map a numeric algorithm id (per AOSP) to the SigAlgorithm enum. */
function mapAlgorithmId(id: number): SigAlgorithm {
  switch (id) {
    case 0x0101:
      return 'RSA_PSS_SHA256';
    case 0x0102:
      return 'RSA_PSS_SHA512';
    case 0x0103:
      return 'RSA_PKCS1_V1_5_SHA256';
    case 0x0104:
      return 'RSA_PKCS1_V1_5_SHA512';
    case 0x0201:
      return 'ECDSA_SHA256';
    case 0x0202:
      return 'ECDSA_SHA512';
    case 0x0301:
      return 'DSA_SHA256';
    case 0x0421:
      return 'VERITY_RSA_PKCS1_V1_5_SHA256';
    case 0x0423:
      return 'VERITY_ECDSA_SHA256';
    case 0x0425:
      return 'VERITY_DSA_SHA256';
    default:
      return 'UNKNOWN';
  }
}

function toHexId(id: number): string {
  return `0x${(id >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * Read a 64-bit little-endian length field as a regular JS number. The
 * AOSP spec uses u64 for forward compatibility but in practice the value
 * never exceeds 2^32 (signing blocks are bounded by APK size). We refuse
 * to operate on values that exceed Number.MAX_SAFE_INTEGER.
 */
function readU64LEAsNumber(buf: Buffer, offset: number): number {
  const lo = buf.readUInt32LE(offset);
  const hi = buf.readUInt32LE(offset + 4);
  if (hi > 0x1f_ffff) {
    // > 2^53 — unsafe.
    throw new ToolError(
      'VALIDATION',
      `u64 length exceeds Number.MAX_SAFE_INTEGER at offset ${offset}`,
    );
  }
  return hi * 0x1_0000_0000 + lo;
}

// Used to keep the proofOfRotation attribute id import alive — used in the
// report wiring. Marker kept so future enhancements can wire raw PoR bytes
// through.
export const PROOF_OF_ROTATION_ATTR_ID = BLOCK_ID_PROOF_OF_ROTATION_ATTR;

/**
 * Minimal length-prefixed buffer reader used inside the signers tree.
 *
 * Each method advances the internal cursor and throws `ToolError(VALIDATION)`
 * on overrun, which the caller turns into a `warnings[]` entry.
 */
class LengthReader {
  private cursor = 0;
  constructor(
    private readonly buf: Buffer,
    private readonly label: string,
  ) {}

  position(): number {
    return this.cursor;
  }
  remaining(): number {
    return this.buf.length - this.cursor;
  }
  readU32(): number {
    if (this.remaining() < 4) {
      throw new ToolError('VALIDATION', `Underflow reading u32 in ${this.label}`);
    }
    const v = this.buf.readUInt32LE(this.cursor);
    this.cursor += 4;
    return v;
  }
  readSlice(len: number, name: string): Buffer {
    if (len < 0 || len > this.remaining()) {
      throw new ToolError(
        'VALIDATION',
        `Underflow reading slice "${name}" (need ${len}, have ${this.remaining()}) in ${this.label}`,
      );
    }
    const slice = this.buf.subarray(this.cursor, this.cursor + len);
    this.cursor += len;
    return slice;
  }
}
