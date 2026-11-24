/**
 * Regression tests for ToolError mapping of raw fs failures and short reads.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fsState = vi.hoisted(() => ({
  stat: vi.fn(),
  readFile: vi.fn(),
  open: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  stat: fsState.stat,
  readFile: fsState.readFile,
  open: fsState.open,
}));

import { DART_SNAPSHOT_MAGIC } from '@modules/dart-inspector/snapshot-types';
import type { VersionFingerprint } from '@modules/dart-inspector/snapshot-types';
import { ObjectPoolDumper } from '@modules/dart-inspector/ObjectPoolDumper';
import { PackageDetector } from '@modules/dart-inspector/PackageDetector';
import type { StringsExtractor } from '@modules/dart-inspector/StringsExtractor';
import { Symbolizer } from '@modules/dart-inspector/Symbolizer';
import { ToolError } from '@errors/ToolError';

function fsError(code: string): NodeJS.ErrnoException {
  const err = new Error(`${code}: synthetic failure`);
  (err as NodeJS.ErrnoException).code = code;
  return err as NodeJS.ErrnoException;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PackageDetector — fs error classification', () => {
  it('maps permission failures to PERMISSION instead of NOT_FOUND', async () => {
    fsState.stat.mockRejectedValue(fsError('EACCES'));
    await expect(new PackageDetector().detect({ filePath: 'blocked.bin' })).rejects.toMatchObject({
      name: 'ToolError',
      code: 'PERMISSION',
    });
  });

  it('wraps raw extraction failures as ToolError', async () => {
    fsState.stat.mockResolvedValue({ size: 10 });
    const extractor = {
      extractFromFile: vi.fn().mockRejectedValue(fsError('EIO')),
    } as unknown as StringsExtractor;
    await expect(
      new PackageDetector(extractor).detect({ filePath: 'racing.bin' }),
    ).rejects.toMatchObject({ name: 'ToolError', code: 'RUNTIME' });
  });

  it('passes existing ToolErrors through unchanged', async () => {
    fsState.stat.mockResolvedValue({ size: 10 });
    const original = new ToolError('VALIDATION', 'not a regular file');
    const extractor = {
      extractFromFile: vi.fn().mockRejectedValue(original),
    } as unknown as StringsExtractor;
    await expect(new PackageDetector(extractor).detect({ filePath: 'dir' })).rejects.toBe(original);
  });
});

describe('Symbolizer — fs error classification', () => {
  it('maps read failures to PERMISSION', async () => {
    fsState.stat.mockResolvedValue({ size: 10 });
    fsState.readFile.mockRejectedValue(fsError('EACCES'));
    await expect(new Symbolizer().resolveNames(['a1'], 'map.json')).rejects.toMatchObject({
      name: 'ToolError',
      code: 'PERMISSION',
    });
  });

  it('maps a file deleted after stat() to NOT_FOUND', async () => {
    fsState.stat.mockResolvedValue({ size: 10 });
    fsState.readFile.mockRejectedValue(fsError('ENOENT'));
    await expect(new Symbolizer().resolveNames(['a1'], 'map.json')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('maps stat permission failures to PERMISSION', async () => {
    fsState.stat.mockRejectedValue(fsError('EPERM'));
    await expect(new Symbolizer().resolveNames(['a1'], 'map.json')).rejects.toMatchObject({
      code: 'PERMISSION',
    });
  });
});

describe('ObjectPoolDumper — short slot-table read', () => {
  it('rejects a short slot-table read with NOT_FOUND instead of decoding zeros', async () => {
    fsState.stat.mockResolvedValue({ size: 4096 });
    const read = vi
      .fn()
      // Header probe: full read.
      .mockImplementationOnce(async (buf: Buffer, _off: number, len: number) => ({
        bytesRead: len,
        buffer: buf,
      }))
      // Slot table: short read.
      .mockImplementationOnce(async (buf: Buffer) => ({ bytesRead: 1, buffer: buf }));
    fsState.open.mockResolvedValue({ read, close: vi.fn(async () => undefined) });

    const fingerprint: VersionFingerprint = {
      magic: DART_SNAPSHOT_MAGIC,
      kind: 'full-aot',
      hash: '',
      features: [],
      targetArch: 'arm64',
      isProduction: true,
      fileOffset: 0,
      source: 'byte-scan',
      unknown: true,
    };

    await expect(
      new ObjectPoolDumper().dump('short-read.bin', { fingerprint, grammar: '2.17' }),
    ).rejects.toMatchObject({ name: 'ToolError', code: 'NOT_FOUND' });
  });
});
