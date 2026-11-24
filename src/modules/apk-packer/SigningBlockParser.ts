/**
 * SigningBlockParser — read-only parser for the APK Signing Block (v2/v3/
 * v3.1) plus heuristic detection of non-standard residue blocks and
 * dex-prefix-anomaly layouts (where a DEX header is prepended to the file
 * so DEX loaders and ZIP loaders disagree on the content).
 *
 * NOTE: APK Signature Scheme v4 is intentionally NOT parsed here — per AOSP
 * v4 is a detached signature in a separate `.apk.idsig` sidecar, not an
 * ID-value pair inside the Signing Block (`0x42726577` is verity padding).
 * See docs/operations/descope-spike-findings.md.
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
 *   - AOSP v4 spec   https://source.android.com/docs/security/features/apksigning/v4 (sidecar rationale)
 *   - apksig source  tools/apksig/src/main/java/com/android/apksig/internal/apk/{v2,v3}/
 */

import { createHash } from 'node:crypto';
import { open, type FileHandle } from 'node:fs/promises';

import { ToolError } from '@errors/ToolError';

import {
  APK_SIGBLOCK_DEX_PREFIX_HEAD_BYTES,
  APK_SIGBLOCK_EOCD_SCAN_BYTES,
  APK_SIGBLOCK_MAX_BYTES,
} from './constants';
import { validateApkFile } from './validate-apk';
import type {
  Anomaly,
  CertificateInfo,
  ProofOfRotation,
  SigAlgorithm,
  SigningBlockReport,
  V2Signer,
  V3Signer,
} from './signing-block-types';
import {
  APK_SIG_BLOCK_MAGIC,
  BLOCK_ID_PROOF_OF_ROTATION_ATTR,
  BLOCK_ID_SOURCE_STAMP,
  BLOCK_ID_UNKNOWN_RESIDUE,
  BLOCK_ID_V2,
  BLOCK_ID_V3,
  BLOCK_ID_V3_1,
  BLOCK_ID_VERITY_PADDING,
  DEX_MAGIC,
  EOCD_SIGNATURE,
} from './signing-block-types';

const SIG_BLOCK_MAGIC_BYTES = Buffer.from(APK_SIG_BLOCK_MAGIC, 'utf8');

// ── EOCD / Signing-Block layout constants (PE/APK binary formats) ──
/** EOCD record is 22 bytes minimum (no comment field). */
const EOCD_MIN_RECORD_SIZE = 22;
/** Offset of the central-directory-offset field within the EOCD record. */
const EOCD_CENTRAL_DIR_OFFSET_FIELD = 16;
/** Offset of the comment-length field within the EOCD record. */
const EOCD_COMMENT_LEN_FIELD = 20;
/** Signing-block trailer: [size_of_block (u64)] [magic (16 B)] = 24 bytes. */
const SIG_BLOCK_TRAILER_SIZE = 24;
/** The u64 size field at the head of the signing block. */
const SIG_BLOCK_SIZE_FIELD = 8;
/** ID-value pair header: [size u64][id u32] = 12 bytes. */
const PAIR_HEADER_SIZE = 12;

interface WriteableSchemes {
  v2?: { signers: V2Signer[] };
  v3?: { signers: V3Signer[]; keyRotation?: ProofOfRotation };
  v3_1?: { signers: V3Signer[] };
  // No v4: see header NOTE (detached .apk.idsig sidecar, not a Signing Block pair).
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
    const { size: fileSize } = await validateApkFile(apkPath);

    let fh: FileHandle | undefined;
    try {
      fh = await open(apkPath, 'r');
      return await this.parseHandle(fh, apkPath, fileSize);
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
    await readFully(fh, tail, tailLen, fileSize - tailLen, 'EOCD scan window');
    const eocdOffsetInTail = findEOCD(tail);
    if (eocdOffsetInTail < 0) {
      state.anomalies.push({
        kind: 'eocd-not-found',
        evidence: `Scanned trailing ${tailLen} bytes — no EOCD signature 0x06054b50`,
      });
      return buildReport(apkPath, fileSize, state, false);
    }
    const centralDirOffset = tail.readUInt32LE(eocdOffsetInTail + EOCD_CENTRAL_DIR_OFFSET_FIELD);
    const fileEOCDOffset = fileSize - tailLen + eocdOffsetInTail;

    // 2. Validate centralDirOffset is sane.
    if (centralDirOffset >= fileEOCDOffset || centralDirOffset < SIG_BLOCK_TRAILER_SIZE) {
      state.warnings.push(
        `Implausible centralDirOffset ${centralDirOffset} given file size ${fileSize}`,
      );
      return buildReport(apkPath, fileSize, state, false);
    }

    // 3. Read 24 bytes immediately preceding centralDirOffset:
    //    [size_of_block (u64)] [magic (16 B "APK Sig Block 42")].
    const trailer = Buffer.alloc(SIG_BLOCK_TRAILER_SIZE);
    await readFully(
      fh,
      trailer,
      SIG_BLOCK_TRAILER_SIZE,
      centralDirOffset - SIG_BLOCK_TRAILER_SIZE,
      'signing-block trailer',
    );
    const magicCandidate = trailer.subarray(SIG_BLOCK_SIZE_FIELD);

    if (!magicCandidate.equals(SIG_BLOCK_MAGIC_BYTES)) {
      // Magic missing at the canonical position — try a small scan.
      const scanWindow = Math.min(centralDirOffset, APK_SIGBLOCK_EOCD_SCAN_BYTES);
      const scanBuf = Buffer.alloc(scanWindow);
      await readFully(
        fh,
        scanBuf,
        scanWindow,
        centralDirOffset - scanWindow,
        'signing-block magic scan window',
      );
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
    const blockStartOffset = centralDirOffset - sizeOfBlock - SIG_BLOCK_SIZE_FIELD;
    if (blockStartOffset < 0) {
      state.warnings.push('Computed signing block start offset is negative — refusing to read');
      return buildReport(apkPath, fileSize, state, false);
    }
    const totalLen = sizeOfBlock + SIG_BLOCK_SIZE_FIELD;
    if (totalLen > APK_SIGBLOCK_MAX_BYTES) {
      state.warnings.push(
        `Signing block total length ${totalLen} exceeds APK_SIGBLOCK_MAX_BYTES — refusing to read`,
      );
      return buildReport(apkPath, fileSize, state, false);
    }
    const block = Buffer.alloc(Number(totalLen));
    await readFully(fh, block, Number(totalLen), blockStartOffset, 'signing block');

    // 5. Parse ID-value pairs. Malformed payloads degrade into warnings
    //    rather than rejecting the whole report (see class contract).
    parseIdValuePairs(block, state);

    // 6. DEX-prefix heuristic — scan first APK_SIGBLOCK_DEX_PREFIX_HEAD_BYTES bytes for DEX magic.
    if (fileSize >= 4) {
      const headLen = Math.min(APK_SIGBLOCK_DEX_PREFIX_HEAD_BYTES, fileSize);
      const head = Buffer.alloc(headLen);
      await readFully(fh, head, headLen, 0, 'DEX-prefix head');
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

/**
 * Read exactly `length` bytes at `position`.
 *
 * `FileHandle.read()` may legally return fewer bytes than requested (truncated
 * or racing files, network filesystems, non-regular files). Parsing the
 * zero-filled tail of a short read would silently produce wrong offsets, so
 * treat any short read as unusable input.
 */
async function readFully(
  fh: FileHandle,
  buf: Buffer,
  length: number,
  position: number,
  label: string,
): Promise<void> {
  const { bytesRead } = await fh.read(buf, 0, length, position);
  if (bytesRead !== length) {
    throw new ToolError(
      'VALIDATION',
      `Short read for ${label}: expected ${length} bytes at offset ${position}, got ${bytesRead}`,
      { details: { label, position, expected: length, bytesRead } },
    );
  }
}

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
  if (tail.length < EOCD_MIN_RECORD_SIZE) return -1;
  for (let i = tail.length - EOCD_MIN_RECORD_SIZE; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD_SIGNATURE) {
      // Validate commentLength field (last 2 bytes) matches remaining buffer.
      const commentLen = tail.readUInt16LE(i + EOCD_COMMENT_LEN_FIELD);
      if (i + EOCD_MIN_RECORD_SIZE + commentLen === tail.length) {
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
  const payloadStart = SIG_BLOCK_SIZE_FIELD;
  const payloadEnd = block.length - SIG_BLOCK_TRAILER_SIZE;
  let cursor = payloadStart;
  while (cursor + PAIR_HEADER_SIZE <= payloadEnd) {
    let pairSize: number;
    try {
      pairSize = readU64LEAsNumber(block, cursor);
    } catch (err) {
      // Oversized u64: treat the rest of the block as unparseable instead of
      // rejecting the report (documented fail-soft contract).
      state.warnings.push(
        `Unreadable ID-value pair header at offset ${cursor}: ${(err as Error).message}`,
      );
      return;
    }
    if (pairSize < 4 || cursor + SIG_BLOCK_SIZE_FIELD + pairSize > payloadEnd) {
      state.warnings.push(`Truncated ID-value pair at offset ${cursor} (pairSize ${pairSize})`);
      return;
    }
    const id = block.readUInt32LE(cursor + SIG_BLOCK_SIZE_FIELD);
    const valueStart = cursor + PAIR_HEADER_SIZE;
    const valueEnd = cursor + SIG_BLOCK_SIZE_FIELD + pairSize;
    const value = block.subarray(valueStart, valueEnd);
    try {
      dispatchBlock(id, value, state);
    } catch (err) {
      // Malformed signer payloads (outer length prefixes included) must not
      // escape as ToolError; degrade into a warning and keep scanning.
      state.warnings.push(`Skipped malformed block ${toHexId(id)}: ${(err as Error).message}`);
    }
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
      const existing = state.schemes.v3;
      if (existing) {
        // A second v3 block is a layout anomaly; merge instead of silently
        // dropping the previously parsed signers.
        state.anomalies.push({
          kind: 'duplicate-scheme',
          evidence: 'v3 signers block (0xf05368c0) appears more than once',
        });
        existing.signers.push(...signers);
        const mergedRotation = collectProofOfRotation(existing.signers);
        if (mergedRotation) existing.keyRotation = mergedRotation;
        return;
      }
      const keyRotation = collectProofOfRotation(signers);
      state.schemes.v3 = keyRotation ? { signers, keyRotation } : { signers };
      return;
    }
    case BLOCK_ID_V3_1: {
      const signers = parseV2OrV3Signers(value, /* isV3 */ true, state) as V3Signer[];
      const existing = state.schemes.v3_1;
      if (existing) {
        state.anomalies.push({
          kind: 'duplicate-scheme',
          evidence: 'v3.1 signers block (0x1b93ad61) appears more than once',
        });
        existing.signers.push(...signers);
        return;
      }
      state.schemes.v3_1 = { signers };
      return;
    }
    case BLOCK_ID_VERITY_PADDING: {
      // 0x42726577 ("Brew") is the verity *padding* block (page alignment).
      // It is not the v4 signature — v4 lives in a separate .idsig file.
      state.unknownBlocks.push({ id: toHexId(id), size: value.length });
      state.warnings.push(
        `Verity padding block (0x42726577, size=${value.length}) present — content ignored`,
      );
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

  // v3 signedData carries a second, signed copy of minSdkVersion/maxSdkVersion
  // between `certificates` and `additionalAttributes` (AOSP V3SchemeVerifier).
  // Older synthetic layouts omit them; distinguish the two shapes by checking
  // whether the length field at offset 8 accounts for the remaining bytes.
  if (isV3) {
    const INNER_SDK_FIELDS = 8; // two u32 values preceding the attrs length
    const maybeAttrsLen = sd.peekU32(INNER_SDK_FIELDS);
    if (maybeAttrsLen !== undefined && maybeAttrsLen === sd.remaining() - 12) {
      sd.readU32(); // inner minSdkVersion
      sd.readU32(); // inner maxSdkVersion
    }
  }

  const attrsLen = sd.readU32();
  const attrsBuf = sd.readSlice(attrsLen, 'attributes');
  const additionalAttributes: V2Signer['additionalAttributes'][number][] = [];
  // Raw bytes of the proofOfRotation attribute payload (after the 4-byte id),
  // stashed internally for lineage decoding. Not part of the public shape.
  let porPayload: Buffer | undefined;
  const attrsReader = new LengthReader(attrsBuf, 'attrs-inner');
  while (attrsReader.remaining() > 0) {
    const oneLen = attrsReader.readU32();
    const oneBuf = attrsReader.readSlice(oneLen, 'attribute');
    if (oneBuf.length < 4) continue;
    const attrId = oneBuf.readUInt32LE(0);
    additionalAttributes.push({ id: toHexId(attrId), size: oneBuf.length });
    if (attrId === BLOCK_ID_PROOF_OF_ROTATION_ATTR) {
      porPayload = Buffer.from(oneBuf.subarray(4));
    }
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
    if (porPayload) POR_BYTES.set(v3, porPayload);
    return v3;
  }
  return base;
}

/**
 * Raw PoR attribute bytes, stashed per-signer during `parseSingleSigner` via
 * an internal WeakMap (NOT part of the public `V3Signer` shape). This lets
 * `collectProofOfRotation` decode a real lineage without exposing raw byte
 * buffers in the JSON report, and without widened public types.
 */
const POR_BYTES = new WeakMap<V3Signer, Buffer>();

/**
 * Decode a v3 `SigningCertificateLineage` attribute payload into levels.
 *
 * Wire shape (AOSP apksig V3SigningCertificateLineage, structural decode —
 * signatures are NOT cryptographically verified here):
 *   repeated, until bytes exhausted:
 *     u32 signedDataLen
 *     signedData:
 *       u32 certLen | cert DER bytes (X.509)
 *       u32 flags
 *     u32 signatureAlgorithmId
 *     u32 signatureLen | signature bytes (read, not verified)
 *
 * Fail-soft: any underflow / zero-length / malformed record aborts and the
 * caller falls back to `{ levels: [] }` (the legacy sentinel behavior), so a
 * malformed lineage never breaks the whole APK report.
 */
export function decodeProofOfRotationBytes(raw: Buffer): ProofOfRotation['levels'] {
  const levels: Array<ProofOfRotation['levels'][number]> = [];
  if (!raw || raw.length < 8) return levels;
  const reader = new LengthReader(raw, 'proof-of-rotation');
  try {
    while (reader.remaining() > 0) {
      const sdLen = reader.readU32();
      if (sdLen < 8) return [];
      const sd = new LengthReader(reader.readSlice(sdLen, 'signedData'), 'por-signedData');
      const certLen = sd.readU32();
      if (certLen === 0) return [];
      const certDer = sd.readSlice(certLen, 'por-cert');
      const flags = sd.readU32();
      const sigAlgId = reader.readU32();
      const sigLen = reader.readU32();
      reader.readSlice(sigLen, 'por-signature'); // structural only, not verified
      levels.push({
        certificate: fingerprintCert(Buffer.from(certDer)),
        flags,
        signedDataSigAlgorithm: mapAlgorithmId(sigAlgId),
      });
    }
  } catch {
    return []; // malformed -> caller uses empty-levels fallback
  }
  return levels;
}

function collectProofOfRotation(signers: ReadonlyArray<V3Signer>): ProofOfRotation | undefined {
  for (const s of signers) {
    const hasMarker = s.additionalAttributes.some(
      (a) => a.id === toHexId(BLOCK_ID_PROOF_OF_ROTATION_ATTR),
    );
    if (!hasMarker) continue;
    const raw = POR_BYTES.get(s);
    const levels = raw ? decodeProofOfRotationBytes(raw) : [];
    // Empty levels is the honest fallback for the legacy sentinel fixture
    // (which carries only the attribute id, no real lineage bytes) and for
    // malformed payloads. A real, decodable chain yields >= 1 level.
    return { levels };
  }
  return undefined;
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

/**
 * Minimal length-prefixed buffer reader used inside the signers tree.
 *
 * Each method advances the internal cursor and throws `ToolError(VALIDATION)`
 * on overrun, which the caller turns into a `warnings[]` entry.
 */
class LengthReader {
  private readonly buf: Buffer;
  private readonly label: string;
  private cursor = 0;
  constructor(buf: Buffer, label: string) {
    this.buf = buf;
    this.label = label;
  }

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
  /** Read a u32 at a relative offset without advancing the cursor. */
  peekU32(relativeOffset = 0): number | undefined {
    if (relativeOffset < 0 || this.remaining() < relativeOffset + 4) return undefined;
    return this.buf.readUInt32LE(this.cursor + relativeOffset);
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
