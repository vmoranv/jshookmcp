/**
 * electron_verify_signature — structural code-signature parser for packaged
 * Electron binaries.
 *
 * The integrity twin of `electron_verify_integrity`: where the latter checks
 * the embedded ElectronAsarIntegrity blob, this tool inspects the binary's own
 * code signature — PE Authenticode (Windows) and Mach-O embedded code signature
 * (macOS). Pure TS binary + ASN.1 parsing: no codesign/signtool CLI dependency,
 * so it runs in any CI. Structural extraction only — signature cryptographic
 * validity, Authenticode timestamp counter-signatures, and notarization tickets
 * are intentionally out of scope (verified:false honest boundary, lesson #51).
 */

import { readFile } from 'node:fs/promises';
import { X509Certificate, createHash } from 'node:crypto';
import type { ToolResponse } from '@server/types';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { parseStringArg, pathExists } from '@server/domains/platform/handlers/platform-utils';

// ── Constants ─────────────────────────────────────────────────────────────

const HASH_OID_TO_NAME: Record<string, string> = {
  '2.16.840.1.101.3.4.2.1': 'sha256',
  '2.16.840.1.101.3.4.2.2': 'sha384',
  '2.16.840.1.101.3.4.2.3': 'sha512',
  '2.16.840.1.101.3.4.2.4': 'sha224',
  '1.3.14.3.2.26': 'sha1',
};

const WIN_CERT_TYPE_PKCS_SIGNED_DATA = 0x0002;
const LC_CODE_SIGNATURE = 0x1d;
const CSMAGIC_EMBEDDED_SIGNATURE = 0xfade0cc0;
const CSMAGIC_CODEDIRECTORY = 0xfade0c02;
const CSMAGIC_BLOBWRAPPER = 0xfade0b01;
const CSSLOT_CODEDIRECTORY = 0;
const CSSLOT_SIGNATURE = 256;

// ── Types ─────────────────────────────────────────────────────────────────

export type SignatureType = 'authenticode' | 'mach-o' | 'none';

export interface CertificateInfo {
  subject: string;
  issuer: string;
  serialNumber: string;
  validFrom: string;
  validTo: string;
  fingerprint256: string;
  keyUsage?: string;
  ca?: boolean;
}

export interface SignatureVerification {
  exePath: string;
  signed: boolean;
  signatureType: SignatureType;
  certificates: CertificateInfo[];
  certificateCount: number;
  unparsedCertificateCount: number;
  digestAlgorithm?: string;
  signer?: CertificateInfo;
  teamId?: string;
  ident?: string;
  cdhash?: string;
  note?: string;
  error?: string;
}

// ── ASN.1 DER walker ──────────────────────────────────────────────────────

interface Asn1Node {
  tag: number;
  /** Full DER bytes (tag + length prefix + value), a slice of the input. */
  der: Buffer;
  /** Value bytes (without the tag/length prefix). */
  value: Buffer;
}

/** Parse a single TLV node at `offset`. Returns the node and the next offset. */
function parseAsn1(buf: Buffer, offset: number): { node: Asn1Node; next: number } | null {
  if (offset + 2 > buf.length) return null;
  const tag = buf[offset];
  const lenByte = buf[offset + 1];
  if (tag === undefined || lenByte === undefined) return null;
  let length: number;
  let valueOffset: number;
  if (lenByte & 0x80) {
    const numBytes = lenByte & 0x7f;
    // Reject indefinite form (numBytes === 0) and >4-byte lengths (overflow risk).
    if (numBytes === 0 || numBytes > 4) return null;
    if (offset + 2 + numBytes > buf.length) return null;
    length = 0;
    for (let i = 0; i < numBytes; i += 1) {
      length = (length << 8) | buf[offset + 2 + i]!;
    }
    valueOffset = offset + 2 + numBytes;
  } else {
    length = lenByte;
    valueOffset = offset + 2;
  }
  if (length < 0 || valueOffset + length > buf.length) return null;
  const value = buf.subarray(valueOffset, valueOffset + length);
  const der = buf.subarray(offset, valueOffset + length);
  return { node: { tag, der, value }, next: valueOffset + length };
}

/** Parse the value of a constructed node into its child TLV nodes. */
function parseAsn1Children(node: Asn1Node): Asn1Node[] {
  const children: Asn1Node[] = [];
  let offset = 0;
  while (offset < node.value.length) {
    const res = parseAsn1(node.value, offset);
    if (!res) break;
    children.push(res.node);
    offset = res.next;
  }
  return children;
}

/** Decode an OID's content bytes (tag already stripped) to dotted form. */
function decodeOid(bytes: Buffer): string {
  if (bytes.length === 0) return '';
  const parts: string[] = [];
  const first = bytes[0]!;
  parts.push(String(Math.floor(first / 40)));
  parts.push(String(first % 40));
  let value = 0;
  for (let i = 1; i < bytes.length; i += 1) {
    value = (value << 7) | (bytes[i]! & 0x7f);
    if (!(bytes[i]! & 0x80)) {
      parts.push(String(value));
      value = 0;
    }
  }
  return parts.join('.');
}

// ── PKCS#7 SignedData ─────────────────────────────────────────────────────

interface Pkcs7Info {
  certificates: Buffer[];
  digestAlgorithmOid: string | null;
}

/**
 * Extract the certificate DER list + signer digest algorithm from a PKCS#7
 * SignedData ContentInfo. Lenient: skips malformed children rather than throwing.
 */
function parsePkcs7SignedData(pkcs7Der: Buffer): Pkcs7Info {
  const result: Pkcs7Info = { certificates: [], digestAlgorithmOid: null };
  const contentInfo = parseAsn1(pkcs7Der, 0);
  if (!contentInfo || contentInfo.node.tag !== 0x30) return result;

  const ciChildren = parseAsn1Children(contentInfo.node);
  if (ciChildren.length < 2) return result;

  // ciChildren[1] = [0] EXPLICIT wrapper around SignedData.
  const explicitWrapper = ciChildren[1]!;
  if (explicitWrapper.tag !== 0xa0) return result;
  const signedDataNode = parseAsn1(explicitWrapper.value, 0);
  if (!signedDataNode || signedDataNode.node.tag !== 0x30) return result;

  const sdChildren = parseAsn1Children(signedDataNode.node);
  // [0] version, [1] digestAlgorithms SET, [2] encapContentInfo,
  // [3] certificates [0] IMPLICIT (optional), [4] crls [1] (optional),
  // [last] signerInfos SET.
  for (const child of sdChildren) {
    if (child.tag === 0xa0) {
      // certificates [0] IMPLICIT — walk children as Certificate DER.
      let off = 0;
      while (off < child.value.length) {
        const certRes = parseAsn1(child.value, off);
        if (!certRes) break;
        if (certRes.node.tag === 0x30) {
          result.certificates.push(Buffer.from(certRes.node.der));
        }
        off = certRes.next;
      }
    }
  }

  // digestAlgorithm: prefer digestAlgorithms SET[0]; fallback signerInfos[0].
  const digestSet = sdChildren[1];
  if (digestSet && digestSet.tag === 0x31) {
    const firstAlgo = parseAsn1Children(digestSet)[0];
    if (firstAlgo) {
      const oidNode = parseAsn1Children(firstAlgo)[0];
      if (oidNode && oidNode.tag === 0x06) {
        result.digestAlgorithmOid = decodeOid(oidNode.value);
      }
    }
  }

  return result;
}

// ── PE Authenticode ───────────────────────────────────────────────────────

/**
 * Locate the Authenticode WIN_CERTIFICATE (PKCS#7 SignedData) in a PE binary.
 * Returns the PKCS#7 DER bytes, or null if the binary is unsigned / not PE.
 */
function parsePeAuthenticode(buf: Buffer): { pkcs7Der: Buffer | null } {
  if (buf.length < 64) return { pkcs7Der: null };
  // DOS stub: "MZ" magic.
  if (buf[0] !== 0x4d || buf[1] !== 0x5a) return { pkcs7Der: null };
  const eLfanew = buf.readUInt32LE(0x3c);
  if (eLfanew < 0 || eLfanew + 24 > buf.length) return { pkcs7Der: null };
  // PE signature "PE\0\0".
  if (buf[eLfanew] !== 0x50 || buf[eLfanew + 1] !== 0x45) return { pkcs7Der: null };
  // COFF header is 20 bytes; OptionalHeader follows. Magic decides PE32 vs PE32+.
  const optStart = eLfanew + 4 + 20;
  if (optStart + 2 > buf.length) return { pkcs7Der: null };
  const optMagic = buf.readUInt16LE(optStart);
  // DataDirectory[IMAGE_DIRECTORY_ENTRY_SECURITY=4] = offset 4*8 into the table.
  // PE32 data-dir starts at optStart+96; PE32+ at optStart+112.
  let secDirOffset: number;
  if (optMagic === 0x10b) secDirOffset = optStart + 96 + 4 * 8;
  else if (optMagic === 0x20b) secDirOffset = optStart + 112 + 4 * 8;
  else return { pkcs7Der: null };
  if (secDirOffset + 8 > buf.length) return { pkcs7Der: null };

  // Security DataDirectory: VirtualAddress is a real FILE offset (not an RVA),
  // Size is the byte length of the certificate table.
  const certOffset = buf.readUInt32LE(secDirOffset);
  const certSize = buf.readUInt32LE(secDirOffset + 4);
  if (certOffset === 0 || certSize === 0) return { pkcs7Der: null };
  if (certOffset + 8 > buf.length) return { pkcs7Der: null };

  // WIN_CERTIFICATE: dwLength(u32) wRevision(u16) wCertificateType(u16) bCertificate[]
  const dwLength = buf.readUInt32LE(certOffset);
  const wCertType = buf.readUInt16LE(certOffset + 6);
  if (wCertType !== WIN_CERT_TYPE_PKCS_SIGNED_DATA) return { pkcs7Der: null };
  const bodyLen = Math.min(dwLength > 8 ? dwLength - 8 : certSize - 8, certSize - 8);
  if (bodyLen <= 0 || certOffset + 8 + bodyLen > buf.length) return { pkcs7Der: null };
  return { pkcs7Der: Buffer.from(buf.subarray(certOffset + 8, certOffset + 8 + bodyLen)) };
}

// ── Mach-O code signature ─────────────────────────────────────────────────

interface MachoSignatureInfo {
  ident?: string;
  cdhash?: string;
  cmsPkcs7Der: Buffer | null;
}

function parseMachoCodeSignature(buf: Buffer): MachoSignatureInfo | null {
  if (buf.length < 28) return null;
  // Fat binary magic is always big-endian; if present, jump to the first slice.
  const fatMagicBE = buf.readUInt32BE(0);
  let sliceOff = 0;
  if (fatMagicBE === 0xcafebabe) {
    const nfat = buf.readUInt32BE(4);
    if (nfat < 1 || nfat > 16) return null;
    // fat_header = magic(4)+nfat(4); fat_arch[0] starts at byte 8; its offset
    // field is at fat_arch byte 8 → absolute byte 16.
    if (16 + 4 > buf.length) return null;
    sliceOff = buf.readUInt32BE(16);
    if (sliceOff + 28 > buf.length) return null;
  }

  // Mach-O magic read little-endian (Intel/Apple-silicon targets are LE).
  const magicLE = buf.readUInt32LE(sliceOff);
  const is64 = magicLE === 0xfeedfacf;
  if (magicLE !== 0xfeedface && magicLE !== 0xfeedfacf) return null;

  // header: magic, cputype, cpusubtype, filetype, ncmds, sizeofcmds, flags[, reserved]
  const ncmds = buf.readUInt32LE(sliceOff + 16);
  const headerSize = is64 ? 32 : 28;
  let cmdOff = sliceOff + headerSize;
  let codeSigOff = 0;
  let codeSigSize = 0;
  for (let i = 0; i < ncmds && cmdOff + 8 <= buf.length; i += 1) {
    const cmd = buf.readUInt32LE(cmdOff);
    const cmdsize = buf.readUInt32LE(cmdOff + 4);
    if (cmdsize < 8) break;
    if (cmd === LC_CODE_SIGNATURE) {
      // linkedit_data_command: cmd, cmdsize, dataoff(u32), datasize(u32).
      codeSigOff = buf.readUInt32LE(cmdOff + 8);
      codeSigSize = buf.readUInt32LE(cmdOff + 12);
      break;
    }
    cmdOff += cmdsize;
  }
  if (codeSigOff === 0 || codeSigSize <= 0 || codeSigOff + codeSigSize > buf.length) {
    return null;
  }
  return parseCodeSignatureSuperBlob(buf, codeSigOff, codeSigSize);
}

/**
 * Walk an embedded-signature SuperBlob at `off`: extract CodeDirectory ident +
 * best-effort cdhash, and the CMS (PKCS#7) signature blob for the cert chain.
 */
function parseCodeSignatureSuperBlob(
  buf: Buffer,
  off: number,
  size: number,
): MachoSignatureInfo | null {
  if (off + 12 > buf.length) return null;
  const magic = buf.readUInt32BE(off);
  if (magic !== CSMAGIC_EMBEDDED_SIGNATURE) return null;
  const count = buf.readUInt32BE(off + 8);
  const indexBase = off + 12;

  const info: MachoSignatureInfo = { cmsPkcs7Der: null };
  for (let i = 0; i < count; i += 1) {
    const entryOff = indexBase + i * 8;
    if (entryOff + 8 > buf.length) break;
    const blobType = buf.readUInt32BE(entryOff);
    const blobRel = buf.readUInt32BE(entryOff + 4);
    const blobOff = off + blobRel;
    if (blobOff + 8 > buf.length) continue;
    const blobMagic = buf.readUInt32BE(blobOff);
    const blobLength = buf.readUInt32BE(blobOff + 4);
    const blobEnd = Math.min(blobOff + blobLength, buf.length);
    if (blobEnd <= blobOff + 8) continue;

    if (blobType === CSSLOT_CODEDIRECTORY && blobMagic === CSMAGIC_CODEDIRECTORY) {
      // CodeDirectory field layout (all big-endian):
      //   magic(4) length(4) version(4) flags(4) digestOffset(4) identOffset(4) ...
      const identOffset = buf.readUInt32BE(blobOff + 20);
      if (identOffset > 0 && blobOff + identOffset < blobEnd) {
        let end = blobOff + identOffset;
        while (end < blobEnd && buf[end] !== 0) end += 1;
        info.ident = buf.subarray(blobOff + identOffset, end).toString('utf-8');
      }
      // Best-effort cdhash: SHA-1 over the CodeDirectory blob. Apple's exact
      // cdhash zeroes the hashOffset region first; we document this as a
      // structural approximation (verified:false) — sufficient for fingerprinting.
      info.cdhash = createHash('sha1').update(buf.subarray(blobOff, blobEnd)).digest('hex');
    } else if (blobType === CSSLOT_SIGNATURE && blobMagic === CSMAGIC_BLOBWRAPPER) {
      info.cmsPkcs7Der = Buffer.from(buf.subarray(blobOff + 8, blobEnd));
    }
  }
  void size;
  return info;
}

// ── X.509 parsing (best-effort) ───────────────────────────────────────────

function parseX509(certDer: Buffer): CertificateInfo | null {
  try {
    const x509 = new X509Certificate(certDer);
    const keyUsage = typeof x509.keyUsage === 'string' ? x509.keyUsage : undefined;
    return {
      subject: x509.subject,
      issuer: x509.issuer,
      serialNumber: x509.serialNumber,
      validFrom: x509.validFrom,
      validTo: x509.validTo,
      fingerprint256: x509.fingerprint256,
      keyUsage,
      ca: x509.ca,
    };
  } catch {
    return null;
  }
}

/** Extract a macOS TeamID (10-char alphanumeric) from a Developer-ID cert CN. */
function extractTeamId(subject: string): string | undefined {
  const match = subject.match(/\(([A-Z0-9]{10})\)/);
  return match?.[1];
}

function oidToHashName(oid: string | null): string | undefined {
  if (!oid) return undefined;
  return HASH_OID_TO_NAME[oid] ?? oid;
}

// ── Handler ───────────────────────────────────────────────────────────────

export async function handleElectronVerifySignature(
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  return handleSafe(async () => {
    const exePath = parseStringArg(args, 'exePath', true);
    if (!exePath) throw new Error('exePath must be a non-empty string');
    if (!(await pathExists(exePath))) {
      const result: SignatureVerification = {
        exePath,
        signed: false,
        signatureType: 'none',
        certificates: [],
        certificateCount: 0,
        unparsedCertificateCount: 0,
        error: `File does not exist: ${exePath}`,
      };
      return result;
    }

    const buffer = await readFile(exePath);

    // PE Authenticode: detect via MZ magic.
    if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) {
      const pe = parsePeAuthenticode(buffer);
      if (pe.pkcs7Der) {
        return buildAuthenticodeResult(exePath, pe.pkcs7Der);
      }
    }

    // Mach-O embedded code signature.
    const macho = parseMachoCodeSignature(buffer);
    if (macho) {
      return buildMachoResult(exePath, macho);
    }

    const result: SignatureVerification = {
      exePath,
      signed: false,
      signatureType: 'none',
      certificates: [],
      certificateCount: 0,
      unparsedCertificateCount: 0,
      note:
        'No PE Authenticode (IMAGE_DIRECTORY_ENTRY_SECURITY) or Mach-O embedded ' +
        'code signature (LC_CODE_SIGNATURE) detected in the binary.',
    };
    return result;
  });
}

function buildAuthenticodeResult(exePath: string, pkcs7Der: Buffer): SignatureVerification {
  const pkcs7 = parsePkcs7SignedData(pkcs7Der);
  const certificates: CertificateInfo[] = [];
  let unparsed = 0;
  for (const certDer of pkcs7.certificates) {
    const info = parseX509(certDer);
    if (info) certificates.push(info);
    else unparsed += 1;
  }
  const signer = certificates[0];
  return {
    exePath,
    signed: true,
    signatureType: 'authenticode',
    certificates,
    certificateCount: pkcs7.certificates.length,
    unparsedCertificateCount: unparsed,
    digestAlgorithm: oidToHashName(pkcs7.digestAlgorithmOid),
    signer,
    teamId: signer ? extractTeamId(signer.subject) : undefined,
    note:
      'Authenticode PKCS#7 SignedData parsed structurally (cert chain + digest ' +
      'algorithm). Cryptographic signature verification and Authenticode timestamp ' +
      'counter-signature are out of scope (verified:false).',
  };
}

function buildMachoResult(exePath: string, macho: MachoSignatureInfo): SignatureVerification {
  const result: SignatureVerification = {
    exePath,
    signed: true,
    signatureType: 'mach-o',
    certificates: [],
    certificateCount: 0,
    unparsedCertificateCount: 0,
    ident: macho.ident,
    cdhash: macho.cdhash,
    note:
      'Mach-O embedded code signature parsed (SuperBlob + CodeDirectory). cdhash ' +
      'is a best-effort SHA-1 over the CodeDirectory blob — Apple’s exact cdhash ' +
      'zeroes the hashOffset region first (verified:false approximation).',
  };

  if (macho.cmsPkcs7Der) {
    const pkcs7 = parsePkcs7SignedData(macho.cmsPkcs7Der);
    for (const certDer of pkcs7.certificates) {
      const info = parseX509(certDer);
      if (info) result.certificates.push(info);
      else result.unparsedCertificateCount += 1;
    }
    result.certificateCount = pkcs7.certificates.length;
    result.digestAlgorithm = oidToHashName(pkcs7.digestAlgorithmOid);
    result.signer = result.certificates[0];
    if (result.signer) result.teamId = extractTeamId(result.signer.subject);
  }
  return result;
}
