import { mkdtemp, rm, writeFile as fsWriteFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleElectronVerifyIntegrity } from '@server/domains/platform/handlers/electron-integrity-handler';
import type { ToolResponse } from '@server/types';

function parseJson(res: ToolResponse): Record<string, unknown> {
  const text = res.content[0] as { text: string };
  return JSON.parse(text.text);
}

/** Build a minimal valid ASAR buffer (4x u32 prefix + header JSON + data). */
function buildAsar(headerObject: Record<string, unknown>, dataChunks: Buffer[] = []): Buffer {
  const headerJson = JSON.stringify(headerObject);
  const headerBuf = Buffer.from(headerJson, 'utf-8');
  const headerLength = headerBuf.length;
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(headerLength + 8, 0); // headerSize
  prefix.writeUInt32LE(headerLength + 4, 4); // headerStringSize
  prefix.writeUInt32LE(headerLength, 8); // headerContentSize
  prefix.writeUInt32LE(0, 12); // padding
  return Buffer.concat([prefix, headerBuf, ...dataChunks]);
}

function hashBase64(buffer: Buffer, algorithm = 'sha256'): string {
  return createHash(algorithm).update(buffer).digest('base64');
}

describe('handleElectronVerifyIntegrity', () => {
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
    const dir = await mkdtemp(join(tmpdir(), 'electron-integrity-'));
    tempDirs.push(dir);
    return dir;
  }

  it('verifies an ASAR whose header pickle hash matches the embedded integrity', async () => {
    const dir = await makeTempDir();

    // Build a minimal ASAR.
    const asar = buildAsar({ files: { 'main.js': { size: 5, offset: '0' } } }, [
      Buffer.from('hello'),
    ]);
    const asarPath = join(dir, 'app.asar');
    await fsWriteFile(asarPath, asar);

    // Electron hashes the header pickle region (bytes 8..8+headerStringSize).
    const headerStringSize = asar.readUInt32LE(4);
    const expectedHash = hashBase64(asar.subarray(8, 8 + headerStringSize));

    // Build a synthetic "binary" with the embedded integrity JSON (value layout).
    const integrityValue = JSON.stringify({
      'ElectronAsar.pkg': { algorithm: 'SHA256', hash: expectedHash },
    });
    const binary = Buffer.from(
      `...some-prefix..."ElectronAsarIntegrity":${integrityValue}...trailing...`,
      'utf8',
    );
    const exePath = join(dir, 'app.exe');
    await fsWriteFile(exePath, binary);

    const result = await handleElectronVerifyIntegrity({ exePath, asarPath });
    const json = parseJson(result);

    expect(json.success).toBe(true);
    expect(json.integrityEmbedded).toBe(true);
    expect(json.verifiedCount).toBe(1);
    expect(json.mismatchCount).toBe(0);
    expect(json.overallVerdict).toBe('verified');
    const entry = (json.entries as Array<Record<string, unknown>>)[0]!;
    expect(entry.verdict).toBe('verified');
    expect(entry.embeddedHash).toBe(expectedHash);
  });

  it('reports a mismatch when the ASAR was tampered after build', async () => {
    const dir = await makeTempDir();

    const asar = buildAsar({ files: { 'main.js': { size: 5, offset: '0' } } }, [
      Buffer.from('hello'),
    ]);
    const asarPath = join(dir, 'app.asar');
    await fsWriteFile(asarPath, asar);

    // Embed a bogus hash that will not match any computed region.
    const integrityValue = JSON.stringify({
      'app.asar': { algorithm: 'SHA256', hash: 'BogusBase64Hash==' },
    });
    const binary = Buffer.from(`binary-prefix..."ElectronAsarIntegrity":${integrityValue}`, 'utf8');
    const exePath = join(dir, 'app.exe');
    await fsWriteFile(exePath, binary);

    const result = await handleElectronVerifyIntegrity({ exePath, asarPath });
    const json = parseJson(result);

    expect(json.success).toBe(true);
    expect(json.mismatchCount).toBe(1);
    expect(json.overallVerdict).toBe('tamper-detected');
    const entry = (json.entries as Array<Record<string, unknown>>)[0]!;
    expect(entry.verdict).toBe('mismatch');
  });

  it('verifies SHA512 integrity entries without reporting false tampering', async () => {
    const dir = await makeTempDir();
    const asar = buildAsar({ files: { 'main.js': { size: 5, offset: '0' } } }, [
      Buffer.from('hello'),
    ]);
    const asarPath = join(dir, 'app.asar');
    await fsWriteFile(asarPath, asar);

    const headerStringSize = asar.readUInt32LE(4);
    const expectedHash = hashBase64(asar.subarray(8, 8 + headerStringSize), 'sha512');
    const integrityValue = JSON.stringify({
      'app.asar': { algorithm: 'SHA512', hash: expectedHash },
    });
    const binary = Buffer.from(`"ElectronAsarIntegrity":${integrityValue}`);
    const exePath = join(dir, 'app.exe');
    await fsWriteFile(exePath, binary);

    const result = await handleElectronVerifyIntegrity({ exePath, asarPath });
    const json = parseJson(result);

    expect(json.verifiedCount).toBe(1);
    expect(json.mismatchCount).toBe(0);
    expect(json.overallVerdict).toBe('verified');
    const entry = (json.entries as Array<Record<string, unknown>>)[0]!;
    expect(entry.embeddedAlgorithm).toBe('SHA512');
    expect(entry.verdict).toBe('verified');
    expect(entry.computedFullFileHash).toBe(hashBase64(asar, 'sha512'));
  });

  it('reports unsupported algorithms as inconclusive instead of mismatch', async () => {
    const dir = await makeTempDir();
    const asar = buildAsar({ files: { 'main.js': { size: 5, offset: '0' } } }, [
      Buffer.from('hello'),
    ]);
    const asarPath = join(dir, 'app.asar');
    await fsWriteFile(asarPath, asar);

    const integrityValue = JSON.stringify({
      'app.asar': { algorithm: 'BLAKE3', hash: 'BogusBase64Hash==' },
    });
    const binary = Buffer.from(`"ElectronAsarIntegrity":${integrityValue}`);
    const exePath = join(dir, 'app.exe');
    await fsWriteFile(exePath, binary);

    const result = await handleElectronVerifyIntegrity({ exePath, asarPath });
    const json = parseJson(result);

    expect(json.verifiedCount).toBe(0);
    expect(json.mismatchCount).toBe(0);
    expect(json.unsupportedAlgorithmCount).toBe(1);
    expect(json.overallVerdict).toBe('inconclusive');
    const entry = (json.entries as Array<Record<string, unknown>>)[0]!;
    expect(entry.verdict).toBe('unsupported-algorithm');
    expect(entry.note).toContain('Unsupported ASAR integrity algorithm');
  });

  it('handles binaries with no embedded integrity JSON gracefully', async () => {
    const dir = await makeTempDir();
    const exePath = join(dir, 'app.exe');
    await fsWriteFile(
      exePath,
      Buffer.from('a plain binary with no integrity json at all'.repeat(2)),
    );

    const result = await handleElectronVerifyIntegrity({ exePath });
    const json = parseJson(result);

    expect(json.success).toBe(true);
    expect(json.integrityEmbedded).toBe(false);
    expect(json.entries).toEqual([]);
    expect(json.note).toContain('No ElectronAsarIntegrity');
  });

  it('auto-detects the ASAR from resources/ when asarPath is omitted', async () => {
    const dir = await makeTempDir();
    const resourcesDir = join(dir, 'resources');
    await mkdir(resourcesDir, { recursive: true });

    const asar = buildAsar({ files: { 'main.js': { size: 3, offset: '0' } } }, [
      Buffer.from('abc'),
    ]);
    // Name the ASAR to match the integrity module path "ElectronAsar.pkg".
    const asarPath = join(resourcesDir, 'ElectronAsar.pkg');
    await fsWriteFile(asarPath, asar);

    const headerStringSize = asar.readUInt32LE(4);
    const expectedHash = hashBase64(asar.subarray(8, 8 + headerStringSize));
    const integrityValue = JSON.stringify({
      'ElectronAsar.pkg': { algorithm: 'SHA256', hash: expectedHash },
    });
    const binary = Buffer.from(`"ElectronAsarIntegrity":${integrityValue}`);
    const exePath = join(dir, 'app.exe');
    await fsWriteFile(exePath, binary);

    const result = await handleElectronVerifyIntegrity({ exePath });
    const json = parseJson(result);

    expect(json.success).toBe(true);
    expect(json.verifiedCount).toBe(1);
    const entry = (json.entries as Array<Record<string, unknown>>)[0]!;
    expect(entry.verdict).toBe('verified');
  });

  it('reports asar-not-found when the ASAR cannot be located', async () => {
    const dir = await makeTempDir();
    const integrityValue = JSON.stringify({
      'nonexistent.asar': { algorithm: 'SHA256', hash: 'dGVzdA==' },
    });
    const binary = Buffer.from(`"ElectronAsarIntegrity":${integrityValue}`);
    const exePath = join(dir, 'app.exe');
    await fsWriteFile(exePath, binary);

    const result = await handleElectronVerifyIntegrity({ exePath });
    const json = parseJson(result);

    expect(json.success).toBe(true);
    const entry = (json.entries as Array<Record<string, unknown>>)[0]!;
    expect(entry.verdict).toBe('asar-not-found');
    expect(entry.asarPath).toBeNull();
  });

  it('returns a failure when the exe path does not exist', async () => {
    const result = await handleElectronVerifyIntegrity({
      exePath: '/definitely/does/not/exist.exe',
    });
    const json = parseJson(result);

    expect(json.success).toBe(false);
    expect(json.error).toContain('does not exist');
  });

  it('returns a failure when exePath is missing', async () => {
    const result = await handleElectronVerifyIntegrity({});
    const json = parseJson(result);

    expect(json.success).toBe(false);
    expect(json.error).toContain('must be a non-empty string');
  });
});
