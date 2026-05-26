/**
 * Synthetic APK fixture generator for SigningBlockParser tests.
 *
 * No real Android tooling involved — we build minimal ZIP archives with a
 * synthetic Signing Block (or none) using only Node's Buffer APIs.
 *
 * Each fixture is fully deterministic: no timestamps, no random keys, no
 * actual signing — the "certificates" are pre-baked 48-byte DER stubs that
 * the parser still happily SHA-256s.
 *
 * Outputs (under `tests/fixtures/apk-packer/`):
 *   - v2-only.apk              single v2 signer
 *   - v3-rotation.apk          v2 + v3 signers, v3 has proofOfRotation attribute
 *   - extra-block-anomaly.apk  v2 + extra 0x42424242 ID-value pair
 *   - no-sigblock.zip          plain ZIP, no signing block at all
 *   - corrupt-eocd.zip         ZIP with the EOCD magic zeroed out
 *
 * Run directly via `tsx tests/fixtures/apk-packer/build-signing-block-fixtures.ts`
 * or invoke `buildAll()` from tests' `beforeAll`.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url));

const APK_SIG_BLOCK_MAGIC = Buffer.from('APK Sig Block 42', 'utf8');

// Signing block IDs (mirrored from src/modules/apk-packer/signing-block-types.ts).
const BLOCK_ID_V2 = 0x7109871a;
const BLOCK_ID_V3 = 0xf05368c0;
const BLOCK_ID_EXTRA_42 = 0x42424242;
const PROOF_OF_ROTATION_ATTR_ID = 0x3ba06f8c;

// Algorithm IDs.
const ALG_RSA_PKCS1_V1_5_SHA256 = 0x0103;

/** Pre-baked 48-byte "DER" stubs — not real certs, but fingerprintable. */
const CERT_BYTES_A = Buffer.from(
  '3082002F308200280203010001A003020102020101300D06092A864886F70D01010B05000000',
  'hex',
).subarray(0, 48);
const CERT_BYTES_B = Buffer.from(
  '3082002F308200280203010001A003020102020102300D06092A864886F70D01010B05000000',
  'hex',
).subarray(0, 48);

// Pad-to-48 if shorter.
function pad48(buf: Buffer): Buffer {
  if (buf.length >= 48) return buf.subarray(0, 48);
  return Buffer.concat([buf, Buffer.alloc(48 - buf.length)]);
}

const CERT_A = pad48(CERT_BYTES_A);
const CERT_B = pad48(CERT_BYTES_B);

// ── ZIP construction helpers ──

interface ZipEntry {
  name: string;
  data: Buffer;
}

/** Compose a minimal ZIP archive (STORED, no compression, no extra fields). */
function buildZip(entries: ZipEntry[]): { archive: Buffer; centralDirOffset: number } {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8');
    // Local file header.
    const lfh = Buffer.alloc(30 + nameBytes.length);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4); // version needed
    lfh.writeUInt16LE(0, 6); // flags
    lfh.writeUInt16LE(0, 8); // method (stored)
    lfh.writeUInt16LE(0, 10); // mtime
    lfh.writeUInt16LE(0x21, 12); // mdate (2000-01-01)
    lfh.writeUInt32LE(0, 14); // crc-32 (placeholder)
    lfh.writeUInt32LE(entry.data.length, 18); // compressed size
    lfh.writeUInt32LE(entry.data.length, 22); // uncompressed size
    lfh.writeUInt16LE(nameBytes.length, 26);
    lfh.writeUInt16LE(0, 28);
    nameBytes.copy(lfh, 30);
    localParts.push(lfh, entry.data);

    // Central directory header.
    const cdh = Buffer.alloc(46 + nameBytes.length);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4); // made by
    cdh.writeUInt16LE(20, 6); // need
    cdh.writeUInt16LE(0, 8);
    cdh.writeUInt16LE(0, 10);
    cdh.writeUInt16LE(0, 12); // mtime
    cdh.writeUInt16LE(0x21, 14); // mdate
    cdh.writeUInt32LE(0, 16); // crc
    cdh.writeUInt32LE(entry.data.length, 20);
    cdh.writeUInt32LE(entry.data.length, 24);
    cdh.writeUInt16LE(nameBytes.length, 28);
    cdh.writeUInt16LE(0, 30);
    cdh.writeUInt16LE(0, 32);
    cdh.writeUInt16LE(0, 34);
    cdh.writeUInt16LE(0, 36);
    cdh.writeUInt32LE(0, 38);
    cdh.writeUInt32LE(offset, 42); // local header offset
    nameBytes.copy(cdh, 46);
    centralParts.push(cdh);

    offset += lfh.length + entry.data.length;
  }
  const localBuf = Buffer.concat(localParts);
  const centralBuf = Buffer.concat(centralParts);
  return { archive: Buffer.concat([localBuf, centralBuf]), centralDirOffset: localBuf.length };
}

/** Build the End Of Central Directory record. */
function buildEOCD(centralDirOffset: number, centralDirSize: number, entryCount: number): Buffer {
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entryCount, 8);
  eocd.writeUInt16LE(entryCount, 10);
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(centralDirOffset, 16);
  eocd.writeUInt16LE(0, 20); // comment length
  return eocd;
}

// ── Signing block construction ──

/** Wrap an arbitrary value with the AOSP length-prefixed sequence convention. */
function lengthPrefixedU32(payload: Buffer): Buffer {
  const out = Buffer.alloc(4 + payload.length);
  out.writeUInt32LE(payload.length, 0);
  payload.copy(out, 4);
  return out;
}

function lengthPrefixedSequence(items: Buffer[]): Buffer {
  const inner = Buffer.concat(items.map(lengthPrefixedU32));
  return lengthPrefixedU32(inner);
}

/** Build one v2-style signer block (also reusable for v3 sans SDK bounds). */
function buildSigner(opts: {
  algorithmId: number;
  cert: Buffer;
  proofOfRotation?: boolean;
  isV3?: boolean;
}): Buffer {
  // signedData = digests(seq) | certificates(seq) | additionalAttributes(seq).
  const digests = lengthPrefixedSequence([
    buildAlgEntry(opts.algorithmId, Buffer.from('deadbeef', 'hex')),
  ]);
  const certs = lengthPrefixedSequence([opts.cert]);
  const attrs: Buffer[] = [];
  if (opts.proofOfRotation) {
    // attribute = u32 id + payload. We just include the id and a 4-byte
    // sentinel payload — the parser only inspects the id.
    const attrBuf = Buffer.alloc(8);
    attrBuf.writeUInt32LE(PROOF_OF_ROTATION_ATTR_ID, 0);
    attrBuf.writeUInt32LE(0xcafebabe, 4);
    attrs.push(attrBuf);
  }
  const additionalAttrs = lengthPrefixedSequence(attrs);
  const signedData = Buffer.concat([digests, certs, additionalAttrs]);

  // signatures = sequence of (algId u32 + signature bytes).
  const signatures = lengthPrefixedSequence([
    buildAlgEntry(opts.algorithmId, Buffer.from('aa55aa55', 'hex')),
  ]);

  // publicKey (we just stuff a 16-byte placeholder).
  const publicKey = lengthPrefixedU32(Buffer.alloc(16, 0xab));

  // signer = signedData(LP) | (if v3: minSdk u32 + maxSdk u32) | signatures(LP) | publicKey(LP).
  const parts: Buffer[] = [lengthPrefixedU32(signedData)];
  if (opts.isV3) {
    const sdkBuf = Buffer.alloc(8);
    sdkBuf.writeUInt32LE(24, 0); // minSdk
    sdkBuf.writeUInt32LE(34, 4); // maxSdk
    parts.push(sdkBuf);
  }
  parts.push(signatures, publicKey);
  return Buffer.concat(parts);
}

function buildAlgEntry(algId: number, body: Buffer): Buffer {
  const buf = Buffer.alloc(4 + body.length);
  buf.writeUInt32LE(algId, 0);
  body.copy(buf, 4);
  return buf;
}

/** Build a `signers` payload (list of signers, length-prefixed). */
function buildSigners(signers: Buffer[]): Buffer {
  return lengthPrefixedSequence(signers);
}

/** Build one ID-value pair (8-byte size + 4-byte id + value). */
function buildIdValuePair(id: number, value: Buffer): Buffer {
  const pairSize = BigInt(4 + value.length);
  const out = Buffer.alloc(8 + 4 + value.length);
  out.writeBigUInt64LE(pairSize, 0);
  out.writeUInt32LE(id, 8);
  value.copy(out, 12);
  return out;
}

/** Wrap a list of ID-value pairs into the full Signing Block. */
function buildSigningBlock(pairs: Buffer[]): Buffer {
  const payload = Buffer.concat(pairs);
  // size_of_block (excludes leading 8-byte size field) = payload + 8 (trailing size) + 16 (magic).
  const sizeOfBlock = BigInt(payload.length + 8 + 16);
  const lead = Buffer.alloc(8);
  lead.writeBigUInt64LE(sizeOfBlock, 0);
  const trail = Buffer.alloc(8);
  trail.writeBigUInt64LE(sizeOfBlock, 0);
  return Buffer.concat([lead, payload, trail, APK_SIG_BLOCK_MAGIC]);
}

// ── Fixture composition ──

function composeApkWithSigningBlock(entries: ZipEntry[], signingBlock: Buffer): Buffer {
  const zip = buildZip(entries);
  const localPart = zip.archive.subarray(0, zip.centralDirOffset);
  const centralPart = zip.archive.subarray(zip.centralDirOffset);
  // New layout: local | signing block | central directory | EOCD.
  const newCentralDirOffset = localPart.length + signingBlock.length;
  const eocd = buildEOCD(newCentralDirOffset, centralPart.length, entries.length);
  return Buffer.concat([localPart, signingBlock, centralPart, eocd]);
}

function composePlainZip(entries: ZipEntry[]): Buffer {
  const zip = buildZip(entries);
  const eocd = buildEOCD(
    zip.centralDirOffset,
    zip.archive.length - zip.centralDirOffset,
    entries.length,
  );
  return Buffer.concat([zip.archive, eocd]);
}

// ── Public API ──

export interface FixturePaths {
  v2Only: string;
  v3Rotation: string;
  extraBlockAnomaly: string;
  noSigblock: string;
  corruptEocd: string;
}

export async function buildAll(): Promise<FixturePaths> {
  await mkdir(FIXTURE_DIR, { recursive: true });

  const entries: ZipEntry[] = [
    { name: 'AndroidManifest.xml', data: Buffer.from('placeholder', 'utf8') },
  ];

  // v2-only
  const v2Signer = buildSigner({ algorithmId: ALG_RSA_PKCS1_V1_5_SHA256, cert: CERT_A });
  const v2Pair = buildIdValuePair(BLOCK_ID_V2, buildSigners([v2Signer]));
  const v2Only = composeApkWithSigningBlock(entries, buildSigningBlock([v2Pair]));
  const v2Path = join(FIXTURE_DIR, 'v2-only.apk');
  await writeFile(v2Path, v2Only);

  // v3-rotation (v2 + v3, v3 carries proofOfRotation attr).
  const v3Signer = buildSigner({
    algorithmId: ALG_RSA_PKCS1_V1_5_SHA256,
    cert: CERT_B,
    proofOfRotation: true,
    isV3: true,
  });
  const v3Pair = buildIdValuePair(BLOCK_ID_V3, buildSigners([v3Signer]));
  const v3Rotation = composeApkWithSigningBlock(entries, buildSigningBlock([v2Pair, v3Pair]));
  const v3Path = join(FIXTURE_DIR, 'v3-rotation.apk');
  await writeFile(v3Path, v3Rotation);

  // extra-block-anomaly (v2 + bogus 0x42424242 pair).
  const extraBlockPair = buildIdValuePair(
    BLOCK_ID_EXTRA_42,
    Buffer.from('extra-block-payload', 'utf8'),
  );
  const extraBlock = composeApkWithSigningBlock(
    entries,
    buildSigningBlock([v2Pair, extraBlockPair]),
  );
  const extraBlockPath = join(FIXTURE_DIR, 'extra-block-anomaly.apk');
  await writeFile(extraBlockPath, extraBlock);

  // no-sigblock (plain ZIP).
  const noBlock = composePlainZip(entries);
  const noBlockPath = join(FIXTURE_DIR, 'no-sigblock.zip');
  await writeFile(noBlockPath, noBlock);

  // corrupt-eocd (zero out the EOCD magic).
  const corrupt = Buffer.from(noBlock);
  // EOCD is the last 22 bytes; zero its 4-byte magic.
  corrupt.writeUInt32LE(0, corrupt.length - 22);
  const corruptPath = join(FIXTURE_DIR, 'corrupt-eocd.zip');
  await writeFile(corruptPath, corrupt);

  return {
    v2Only: v2Path,
    v3Rotation: v3Path,
    extraBlockAnomaly: extraBlockPath,
    noSigblock: noBlockPath,
    corruptEocd: corruptPath,
  };
}

// Allow running directly via `tsx ...`.
const isMain = (() => {
  try {
    return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();

if (isMain) {
  buildAll()
    .then((paths) => {
      // eslint-disable-next-line no-console
      console.log('Wrote fixtures:', paths);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
