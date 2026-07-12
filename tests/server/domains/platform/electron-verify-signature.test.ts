import { mkdtemp, rm, writeFile as fsWriteFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleElectronVerifySignature } from '@server/domains/platform/handlers/electron-signature-handler';
import type { ToolResponse } from '@server/types';

function parseJson(res: ToolResponse): Record<string, unknown> {
  const text = res.content[0] as { text: string };
  return JSON.parse(text.text);
}

// ── Real self-signed X.509 cert DER (generated offline via openssl, fixed fixture) ─
// Subject: CN=Test Leaf Signer,O=TestOrg,C=US  | sig: sha256WithRSAEncryption
const TEST_CERT_DER_B64 =
  'MIIDVTCCAj2gAwIBAgIUfchx1MkhEuana6tAxg+6kDLewDMwDQYJKoZIhvcNAQELBQAwOjEZMBcG' +
  'A1UEAwwQVGVzdCBMZWFmIFNpZ25lcjEQMA4GA1UECgwHVGVzdE9yZzELMAkGA1UEBhMCVVMwHhcN' +
  'MjYwNzEyMTM0NTAxWhcNMzYwNzA5MTM0NTAxWjA6MRkwFwYDVQQDDBBUZXN0IExlYWYgU2lnbmVy' +
  'MRAwDgYDVQQKDAdUZXN0T3JnMQswCQYDVQQGEwJVUzCCASIwDQYJKoZIhvcNAQEBBQADggEPADCC' +
  'AQoCggEBAMBYPpOtQfDNLN/z6hjmvm3M8lSg24CuvBmBnNaOpGgvi0pGWVw/mzD5Ba1NE07C4tVL' +
  '7YzAGWen+w2ZS9F0olWOAtHV01Ru0ogUHi6jJsaSZDdRV8/csVZeGTtLwgVrvHO+S7jXw+9+L1Kh' +
  '5Fwe/o/YYiPWcnL6BdEJN5AofzyBVtw6CKX+NcS9/L6ng9B6Ym8SY4+f0wbupusHgdD/Q6nk6ls' +
  'RjSuY57RhMIkMGUcAAzGUjCY9gN5MC/NSCEiFEU4yiKiqcFkykRpepf953Jym8hwXql8oy/o9qTp' +
  'L0E5YUgmRpqrUDN2BKOaP8N0jQJfKASEihh+Me/gadiHvvLMCAwEAAaNTMFEwHQYDVR0OBBYEFO' +
  'A55Ad+F8EeceC+dKecr2KtM3s7MB8GA1UdIwQYMBaAFOA55Ad+F8EeceC+dKecr2KtM3s7MA8GA' +
  '1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAKfklIQqsXUcux8lvU5xcm/j5JFNYhzn' +
  'WIAjgTU7qNs6U7KgZ0rbcuXkWMgIDhUGgSzpth0YIWihlosjJo1hVOCss/dh3Wo5ZK48suMpOdb' +
  '6G4JOknMFPePN+zjKxTQLFmmyNxR7NB679nYCLMUGT+L7HVl3a9NdLX7BApAOThGGCZ3EiNlzqp' +
  'JellFPo4u+f8VgTUHQiFskOT/6i1HWtxOR3G4A9UkTaUHF5On8/dmbVuP8x7lH+DJ/JlXss72Qn' +
  'M3BZvFvoaWnI/7sHIFnzjvMHJ0PHQR69BPx70xwtYnOZXzVvB84PhycHsZz47OLA+YZJ/3eZh7Fx' +
  'aHs1zU/Oyg==';

const TEST_CERT_DER = Buffer.from(TEST_CERT_DER_B64, 'base64');
const PKCS7_SIGNED_DATA_OID = '1.2.840.113549.1.7.1'.replace('1.7.1', '1.7.2'); // 1.2.840.113549.1.7.2
const OID_SHA256 = '2.16.840.1.101.3.4.2.1';
const CSMAGIC_EMBEDDED_SIGNATURE = 0xfade0cc0;
const CSMAGIC_CODEDIRECTORY = 0xfade0c02;
const CSMAGIC_BLOBWRAPPER = 0xfade0b01;
const CSSLOT_CODEDIRECTORY = 0;
const CSSLOT_SIGNATURE = 256;
const LC_CODE_SIGNATURE = 0x1d;

// ── ASN.1 DER builder (test fixture only) ─────────────────────────────────

function asn1Length(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length]);
  if (length < 0x100) return Buffer.from([0x81, length]);
  if (length < 0x10000) return Buffer.from([0x82, (length >> 8) & 0xff, length & 0xff]);
  return Buffer.from([0x83, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff]);
}

function asn1Node(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), asn1Length(content.length), content]);
}

function asn1Seq(...children: Buffer[]): Buffer {
  return asn1Node(0x30, Buffer.concat(children));
}

function asn1Set(...children: Buffer[]): Buffer {
  return asn1Node(0x31, Buffer.concat(children));
}

function asn1Oid(oid: string): Buffer {
  const parts = oid.split('.').map(Number);
  const bytes: number[] = [40 * parts[0]! + parts[1]!];
  for (let i = 2; i < parts.length; i += 1) {
    const v = parts[i]!;
    if (v < 0x80) {
      bytes.push(v);
    } else {
      const stack: number[] = [];
      let tmp = v;
      stack.push(tmp & 0x7f);
      tmp >>= 7;
      while (tmp > 0) {
        stack.push((tmp & 0x7f) | 0x80);
        tmp >>= 7;
      }
      stack.reverse();
      bytes.push(...stack);
    }
  }
  return asn1Node(0x06, Buffer.from(bytes));
}

function asn1Int(value: number): Buffer {
  const bytes: number[] = [];
  if (value === 0) {
    bytes.push(0);
  } else {
    let tmp = value;
    while (tmp > 0) {
      bytes.unshift(tmp & 0xff);
      tmp >>= 8;
    }
    if (bytes[0]! & 0x80) bytes.unshift(0);
  }
  return asn1Node(0x02, Buffer.from(bytes));
}

/** Build a PKCS#7 SignedData ContentInfo with one embedded certificate. */
function buildPkcs7SignedData(certDer: Buffer, digestOid: string): Buffer {
  const version = asn1Int(1);
  const digestAlgorithms = asn1Set(asn1Seq(asn1Oid(digestOid)));
  const encapContentInfo = asn1Seq(asn1Oid('1.2.840.113549.1.7.1'));
  const certificates = asn1Node(0xa0, certDer); // [0] IMPLICIT
  const signerInfos = asn1Set(); // empty (structural fixture)
  const signedData = asn1Seq(
    version,
    digestAlgorithms,
    encapContentInfo,
    certificates,
    signerInfos,
  );
  return asn1Seq(asn1Oid(PKCS7_SIGNED_DATA_OID), asn1Node(0xa0, signedData)); // [0] EXPLICIT
}

// ── Synthetic PE with Authenticode ────────────────────────────────────────

function buildPeWithAuthenticode(pkcs7Der: Buffer): Buffer {
  const dos = Buffer.alloc(64);
  dos.write('MZ', 0, 'latin1');
  dos.writeUInt32LE(64, 0x3c); // e_lfanew

  const peSig = Buffer.from([0x50, 0x45, 0x00, 0x00]); // "PE\0\0"

  const optSize = 96 + 5 * 8; // PE32 optional header + 5 data directory entries
  const coff = Buffer.alloc(20);
  coff.writeUInt16LE(0x14c, 0); // machine i386
  coff.writeUInt16LE(0, 2); // numberOfSections
  coff.writeUInt16LE(optSize, 16); // sizeOfOptionalHeader

  const opt = Buffer.alloc(optSize);
  opt.writeUInt16LE(0x10b, 0); // PE32 magic
  opt.writeUInt32LE(5, 92); // numberOfRvaAndSizes (we only populate up to index 4)

  const certOffset = 64 + 4 + 20 + optSize; // file offset of WIN_CERTIFICATE
  opt.writeUInt32LE(certOffset, 96 + 4 * 8); // DataDirectory[4].VirtualAddress
  opt.writeUInt32LE(8 + pkcs7Der.length, 96 + 4 * 8 + 4); // DataDirectory[4].Size

  const winCert = Buffer.alloc(8);
  winCert.writeUInt32LE(8 + pkcs7Der.length, 0); // dwLength
  winCert.writeUInt16LE(0x0200, 4); // wRevision
  winCert.writeUInt16LE(0x0002, 6); // wCertificateType = PKCS_SIGNED_DATA

  return Buffer.concat([dos, peSig, coff, opt, winCert, pkcs7Der]);
}

// ── Synthetic Mach-O with embedded code signature ─────────────────────────

function buildCsBlob(magic: number, content: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(magic, 0);
  header.writeUInt32BE(8 + content.length, 4);
  return Buffer.concat([header, content]);
}

function buildSuperBlob(entries: Array<{ type: number; blob: Buffer }>): Buffer {
  const count = entries.length;
  const indexSize = count * 8;
  const index = Buffer.alloc(indexSize);
  const chunks: Buffer[] = [];
  let cursor = 12 + indexSize;
  for (let i = 0; i < count; i += 1) {
    index.writeUInt32BE(entries[i]!.type, i * 8);
    index.writeUInt32BE(cursor, i * 8 + 4);
    chunks.push(entries[i]!.blob);
    cursor += entries[i]!.blob.length;
  }
  const header = Buffer.alloc(12);
  header.writeUInt32BE(CSMAGIC_EMBEDDED_SIGNATURE, 0);
  header.writeUInt32BE(12 + indexSize + chunks.reduce((n, b) => n + b.length, 0), 4);
  header.writeUInt32BE(count, 8);
  return Buffer.concat([header, index, ...chunks]);
}

function buildMachoWithCodeSignature(opts: { ident: string; cmsPkcs7Der: Buffer | null }): Buffer {
  const headerSize = 32; // 64-bit Mach-O header
  const cmdSize = 16; // LC_CODE_SIGNATURE linkedit_data_command
  const dataOffset = headerSize + cmdSize;

  const identBuf = Buffer.from(`${opts.ident}\0`, 'utf-8');
  const cdContent = Buffer.alloc(16 + identBuf.length);
  cdContent.writeUInt32BE(0, 0); // version
  cdContent.writeUInt32BE(0, 4); // flags
  cdContent.writeUInt32BE(0, 8); // digestOffset
  cdContent.writeUInt32BE(24, 12); // identOffset (8 magic+len + 16 fields)
  identBuf.copy(cdContent, 16);
  const cdBlob = buildCsBlob(CSMAGIC_CODEDIRECTORY, cdContent);

  const entries: Array<{ type: number; blob: Buffer }> = [
    { type: CSSLOT_CODEDIRECTORY, blob: cdBlob },
  ];
  if (opts.cmsPkcs7Der) {
    entries.push({
      type: CSSLOT_SIGNATURE,
      blob: buildCsBlob(CSMAGIC_BLOBWRAPPER, opts.cmsPkcs7Der),
    });
  }
  const superblob = buildSuperBlob(entries);

  const header = Buffer.alloc(headerSize);
  header.writeUInt32LE(0xfeedfacf, 0); // MH_MAGIC_64
  header.writeUInt32LE(0x0100000c, 4); // cputype arm64
  header.writeUInt32LE(0, 8); // cpusubtype
  header.writeUInt32LE(2, 12); // filetype MH_EXECUTE
  header.writeUInt32LE(1, 16); // ncmds
  header.writeUInt32LE(cmdSize, 20); // sizeofcmds
  header.writeUInt32LE(0, 24); // flags
  header.writeUInt32LE(0, 28); // reserved

  const cmd = Buffer.alloc(cmdSize);
  cmd.writeUInt32LE(LC_CODE_SIGNATURE, 0);
  cmd.writeUInt32LE(cmdSize, 4);
  cmd.writeUInt32LE(dataOffset, 8);
  cmd.writeUInt32LE(superblob.length, 12);

  return Buffer.concat([header, cmd, superblob]);
}

describe('handleElectronVerifySignature', () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    tempDirs.length = 0;
  });

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  async function makeTempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'electron-sig-'));
    tempDirs.push(dir);
    return dir;
  }

  it('parses a PE Authenticode PKCS#7 into a certificate chain', async () => {
    const dir = await makeTempDir();
    const pkcs7 = buildPkcs7SignedData(TEST_CERT_DER, OID_SHA256);
    const pe = buildPeWithAuthenticode(pkcs7);
    const exePath = join(dir, 'app.exe');
    await fsWriteFile(exePath, pe);

    const result = await handleElectronVerifySignature({ exePath });
    const json = parseJson(result);

    expect(json.success !== false).toBe(true);
    expect(json.signed).toBe(true);
    expect(json.signatureType).toBe('authenticode');
    expect(json.certificateCount).toBe(1);
    expect(json.unparsedCertificateCount).toBe(0);
    expect(json.digestAlgorithm).toBe('sha256');
    const certs = json.certificates as Array<Record<string, unknown>>;
    expect(certs).toHaveLength(1);
    expect(String(certs[0]!.subject)).toContain('Test Leaf Signer');
    expect(String(certs[0]!.fingerprint256)).toMatch(/^[0-9a-fA-F:]+$/);
    const signer = json.signer as Record<string, unknown>;
    expect(String(signer.subject)).toContain('Test Leaf Signer');
    expect(json.note).toContain('verified:false');
  });

  it('parses a Mach-O embedded code signature (CodeDirectory + CMS)', async () => {
    const dir = await makeTempDir();
    const pkcs7 = buildPkcs7SignedData(TEST_CERT_DER, OID_SHA256);
    const macho = buildMachoWithCodeSignature({ ident: 'com.test.app', cmsPkcs7Der: pkcs7 });
    const exePath = join(dir, 'App');
    await fsWriteFile(exePath, macho);

    const result = await handleElectronVerifySignature({ exePath });
    const json = parseJson(result);

    expect(json.signed).toBe(true);
    expect(json.signatureType).toBe('mach-o');
    expect(json.ident).toBe('com.test.app');
    expect(typeof json.cdhash).toBe('string');
    expect((json.cdhash as string).length).toBe(40); // SHA-1 hex
    expect(json.certificateCount).toBe(1);
    const certs = json.certificates as Array<Record<string, unknown>>;
    expect(String(certs[0]!.subject)).toContain('Test Leaf Signer');
    expect(json.note).toContain('best-effort');
  });

  it('parses a Mach-O signature even without a CMS blob (ident + cdhash only)', async () => {
    const dir = await makeTempDir();
    const macho = buildMachoWithCodeSignature({ ident: 'com.bare.app', cmsPkcs7Der: null });
    const exePath = join(dir, 'Bare');
    await fsWriteFile(exePath, macho);

    const result = await handleElectronVerifySignature({ exePath });
    const json = parseJson(result);

    expect(json.signed).toBe(true);
    expect(json.signatureType).toBe('mach-o');
    expect(json.ident).toBe('com.bare.app');
    expect(json.cdhash).toBeTruthy();
    expect(json.certificateCount).toBe(0);
    expect(json.certificates).toEqual([]);
  });

  it('reports unsigned for a plain PE with no security directory entry', async () => {
    const dir = await makeTempDir();
    const dos = Buffer.alloc(128);
    dos.write('MZ', 0, 'latin1');
    dos.writeUInt32LE(64, 0x3c);
    dos.write('PE', 64, 'latin1');
    dos.writeUInt32LE(0x10b, 64 + 4 + 20); // PE32 magic but no data dir populated
    const exePath = join(dir, 'unsigned.exe');
    await fsWriteFile(exePath, dos);

    const result = await handleElectronVerifySignature({ exePath });
    const json = parseJson(result);

    expect(json.signed).toBe(false);
    expect(json.signatureType).toBe('none');
  });

  it('reports unsigned for a buffer that is neither PE nor Mach-O', async () => {
    const dir = await makeTempDir();
    const exePath = join(dir, 'plain.bin');
    await fsWriteFile(exePath, Buffer.from('not a binary at all, just text'.repeat(4)));

    const result = await handleElectronVerifySignature({ exePath });
    const json = parseJson(result);

    expect(json.signed).toBe(false);
    expect(json.signatureType).toBe('none');
    expect(json.note).toContain('No PE Authenticode');
  });

  it('returns a failure when the exe path does not exist', async () => {
    const result = await handleElectronVerifySignature({ exePath: '/no/such/app.exe' });
    const json = parseJson(result);
    expect(json.signed).toBe(false);
    expect(json.signatureType).toBe('none');
    expect(json.error).toContain('does not exist');
  });

  it('returns a failure when exePath is missing', async () => {
    const result = await handleElectronVerifySignature({});
    const json = parseJson(result);
    expect(json.error).toContain('must be a non-empty string');
  });
});
