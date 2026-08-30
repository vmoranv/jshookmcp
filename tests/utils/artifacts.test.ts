import { resolve, sep } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ROOT = `${resolve('virtual-project-root')}${sep}`;

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  open: vi.fn(async () => ({ close: vi.fn(async () => undefined) })),
  realpath: vi.fn(async (p: string) => p),
  writeFile: vi.fn(async () => undefined),
}));

vi.mock('@src/utils/outputPaths', () => ({
  getProjectRoot: vi.fn(() => ROOT),
}));

import { mkdir, open, realpath, writeFile } from 'node:fs/promises';
import {
  generateShortId,
  getArtifactDir,
  getArtifactsRoot,
  resolveArtifactPath,
  writeArtifactContent,
} from '@utils/artifacts';

function eexistError(): NodeJS.ErrnoException {
  return Object.assign(new Error('EEXIST: file already exists'), { code: 'EEXIST' });
}

describe('artifacts utils', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-03-04T05:06:07.000Z'));
    vi.spyOn(Math, 'random').mockReturnValue(0.123456789);
  });

  it('resolves category path and creates directory', async () => {
    const result = await resolveArtifactPath({
      category: 'har',
      toolName: 'network export',
      target: 'user?id=1',
      ext: 'json',
    });

    expect(result.absolutePath).toContain(resolve(ROOT, 'artifacts', 'har'));
    expect(result.displayPath).toMatch(/^artifacts\/har\//);
    expect(result.displayPath).toContain('network_export-user_id_1');
    expect(mkdir).toHaveBeenCalledWith(resolve(ROOT, 'artifacts', 'har'), { recursive: true });
  });

  it('normalizes extensions with leading dot', async () => {
    const result = await resolveArtifactPath({
      category: 'reports',
      toolName: 'reporter',
      ext: '.md',
    });

    expect(result.absolutePath.endsWith('.md')).toBe(true);
    expect(result.absolutePath.includes('..md')).toBe(false);
  });

  it('uses custom directory when inside project root', async () => {
    const result = await resolveArtifactPath({
      category: 'tmp',
      toolName: 'worker',
      ext: 'txt',
      customDir: 'custom/out',
    });

    expect(result.absolutePath).toContain(resolve(ROOT, 'custom', 'out'));
    expect(result.displayPath.startsWith('custom/out/')).toBe(true);
    expect(mkdir).toHaveBeenCalledWith(resolve(ROOT, 'custom', 'out'), { recursive: true });
  });

  it('blocks path traversal for custom directory outside project', async () => {
    await expect(
      resolveArtifactPath({
        category: 'tmp',
        toolName: 'worker',
        ext: 'txt',
        customDir: '../escape',
      }),
    ).rejects.toThrow('Path traversal blocked');
  });

  it('trims and sanitizes long file name parts', async () => {
    const result = await resolveArtifactPath({
      category: 'dumps',
      toolName: '***very long tool name***'.repeat(8),
      target: '///target///',
      ext: 'bin',
    });

    const filename = result.displayPath.split('/').pop() ?? '';
    const baseWithoutExt = filename.replace(/\.bin$/, '');
    const [toolPart] = baseWithoutExt.split('-');
    expect(toolPart!.length).toBeLessThanOrEqual(60);
    expect(filename).not.toContain('*');
    expect(filename).toContain('target');
  });

  it('returns artifact root helpers', () => {
    expect(getArtifactsRoot()).toBe(resolve(ROOT, 'artifacts'));
    expect(getArtifactDir('wasm')).toBe(resolve(ROOT, 'artifacts', 'wasm'));
  });

  it('generates a unique filename per call even with fixed timestamp and Math.random', async () => {
    const first = await resolveArtifactPath({ category: 'tmp', toolName: 'x', ext: 'txt' });
    const second = await resolveArtifactPath({ category: 'tmp', toolName: 'x', ext: 'txt' });
    // Same fake timestamp + constant Math.random: only the random ID differs
    // (a4-03 — the old 6-char base36 ID collided here, returning identical paths).
    expect(second.absolutePath).not.toBe(first.absolutePath);
  });

  it('uses an 8-char hex ID derived from randomUUID, not a 6-char base36 ID', async () => {
    const result = await resolveArtifactPath({ category: 'tmp', toolName: 'x', ext: 'txt' });
    expect(result.displayPath).toMatch(/[0-9a-f]{8}\.txt$/);
  });

  it('generateShortId produces unique 8-char hex IDs', () => {
    expect(generateShortId()).toMatch(/^[0-9a-f]{8}$/);
    expect(new Set(Array.from({ length: 20 }, () => generateShortId())).size).toBe(20);
  });

  it('reserves the file exclusively and retries once on EEXIST', async () => {
    const mockedOpen = vi.mocked(open);
    mockedOpen.mockClear();
    mockedOpen.mockRejectedValueOnce(eexistError());

    const result = await resolveArtifactPath({ category: 'tmp', toolName: 'x', ext: 'txt' });
    expect(result.absolutePath).toBeDefined();
    // First attempt collided, second attempt reserved the regenerated name.
    expect(mockedOpen).toHaveBeenCalledTimes(2);
    for (const call of mockedOpen.mock.calls) {
      expect(call[1]).toBe('wx');
    }
    expect(mockedOpen.mock.calls[1]?.[0]).not.toBe(mockedOpen.mock.calls[0]?.[0]);
  });

  it('validates and mkdirs a directory only once (process-level cache)', async () => {
    const mockedMkdir = vi.mocked(mkdir);
    const mockedRealpath = vi.mocked(realpath);
    mockedMkdir.mockClear();
    mockedRealpath.mockClear();

    for (let i = 0; i < 3; i++) {
      await resolveArtifactPath({
        category: 'tmp',
        toolName: 'x',
        ext: 'txt',
        customDir: 'cached-dir',
      });
    }

    // First validation performs realpath(root) + realpath(dir); the other two
    // resolutions hit the process-level cache (a4-04) with no further syscalls.
    expect(mockedMkdir).toHaveBeenCalledTimes(1);
    expect(mockedRealpath).toHaveBeenCalledTimes(2);
  });

  // NOTE: the validated-dir cache is process-level and shared across the
  // tests in this file, so each test below uses a distinct directory
  // namespace to stay independent of whatever the earlier tests cached.
  it('bounds the validated-dir cache: distinct client dirs evict the oldest past 64', async () => {
    const mockedMkdir = vi.mocked(mkdir);
    mockedMkdir.mockClear();

    // Fill the cache to its 64-entry cap with distinct client-provided dirs.
    for (let i = 0; i < 64; i++) {
      await resolveArtifactPath({
        category: 'tmp',
        toolName: 'x',
        ext: 'txt',
        customDir: `evict-${i}`,
      });
    }
    expect(mockedMkdir).toHaveBeenCalledTimes(64);

    // One more distinct dir pushes the cache past the cap: the least-recently
    // used entry (evict-0) is evicted, so the Map stays bounded at 64 (a4-05).
    await resolveArtifactPath({
      category: 'tmp',
      toolName: 'x',
      ext: 'txt',
      customDir: 'evict-64',
    });
    expect(mockedMkdir).toHaveBeenCalledTimes(65);

    // evict-0 was evicted, so resolving it again re-validates (a fresh mkdir)
    // instead of accumulating yet another permanent entry.
    await resolveArtifactPath({ category: 'tmp', toolName: 'x', ext: 'txt', customDir: 'evict-0' });
    expect(mockedMkdir).toHaveBeenCalledTimes(66);
  });

  it('refreshes LRU order on cache hit so a hot dir survives eviction', async () => {
    const mockedMkdir = vi.mocked(mkdir);
    mockedMkdir.mockClear();

    for (let i = 0; i < 64; i++) {
      await resolveArtifactPath({
        category: 'tmp',
        toolName: 'x',
        ext: 'txt',
        customDir: `lru-${i}`,
      });
    }
    expect(mockedMkdir).toHaveBeenCalledTimes(64);

    // Touch lru-0: a cache hit must refresh it to most-recently-used, with no
    // re-validation.
    await resolveArtifactPath({ category: 'tmp', toolName: 'x', ext: 'txt', customDir: 'lru-0' });
    expect(mockedMkdir).toHaveBeenCalledTimes(64);

    // Insert lru-64 → evicts the true LRU (lru-1, not the just-touched lru-0).
    await resolveArtifactPath({ category: 'tmp', toolName: 'x', ext: 'txt', customDir: 'lru-64' });
    expect(mockedMkdir).toHaveBeenCalledTimes(65);

    // lru-0 survived (still cached); lru-1 was evicted and is re-validated.
    await resolveArtifactPath({ category: 'tmp', toolName: 'x', ext: 'txt', customDir: 'lru-0' });
    expect(mockedMkdir).toHaveBeenCalledTimes(65);
    await resolveArtifactPath({ category: 'tmp', toolName: 'x', ext: 'txt', customDir: 'lru-1' });
    expect(mockedMkdir).toHaveBeenCalledTimes(66);
  });
});

describe('writeArtifactContent', () => {
  beforeEach(() => {
    vi.mocked(writeFile).mockClear();
  });

  it('writes plaintext content as-is when encrypt is not requested', async () => {
    const result = await writeArtifactContent(resolve(ROOT, 'artifacts/tmp/x.txt'), 'hello world');
    expect(result.encryptionKeyHex).toBeUndefined();
    expect(writeFile).toHaveBeenCalledWith(
      resolve(ROOT, 'artifacts/tmp/x.txt'),
      Buffer.from('hello world', 'utf8'),
    );
  });

  it('encrypts content and returns a key when encrypt is requested', async () => {
    const result = await writeArtifactContent(resolve(ROOT, 'artifacts/dumps/x.bin'), 'sensitive', {
      encrypt: true,
    });
    expect(result.encryptionKeyHex).toMatch(/^[0-9a-f]{64}$/);

    expect(writeFile).toHaveBeenCalledTimes(1);
    const [writtenPath, writtenContent, writeOptions] = vi.mocked(writeFile).mock.calls[0]!;
    expect(writtenPath).toBe(resolve(ROOT, 'artifacts/dumps/x.bin'));
    expect(writeOptions).toEqual({ mode: 0o600 });

    const envelope = JSON.parse(writtenContent as string);
    expect(envelope.algorithm).toBe('aes-256-gcm');
    expect(envelope.payload).not.toContain('sensitive');
  });

  it('accepts Uint8Array content for both plaintext and encrypted writes', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await writeArtifactContent(resolve(ROOT, 'artifacts/dumps/bin.dat'), bytes, { encrypt: true });
    expect(writeFile).toHaveBeenCalledTimes(1);
  });

  it('auto-encrypts content for dumps, traces, profiles, captures, sessions, har categories', async () => {
    const sensitiveCategories = [
      'dumps',
      'traces',
      'profiles',
      'captures',
      'sessions',
      'har',
    ] as const;
    for (const category of sensitiveCategories) {
      vi.mocked(writeFile).mockClear();
      const result = await writeArtifactContent(
        resolve(ROOT, `artifacts/${category}/auto.txt`),
        'sensitive payload',
        { category },
      );
      expect(result.encryptionKeyHex, `category=${category} should default-encrypt`).toMatch(
        /^[0-9a-f]{64}$/,
      );
      const [, writtenContent, writeOptions] = vi.mocked(writeFile).mock.calls[0]!;
      expect(writeOptions, `category=${category} should write with 0o600`).toEqual({ mode: 0o600 });
      const envelope = JSON.parse(writtenContent as string);
      expect(envelope.algorithm, `category=${category} envelope`).toBe('aes-256-gcm');
      expect(envelope.payload, `category=${category} ciphertext`).not.toContain(
        'sensitive payload',
      );
    }
  });

  it('keeps plaintext for non-sensitive categories (reports, tmp, offloaded, wasm)', async () => {
    const nonSensitiveCategories = ['reports', 'tmp', 'offloaded', 'wasm'] as const;
    for (const category of nonSensitiveCategories) {
      vi.mocked(writeFile).mockClear();
      const result = await writeArtifactContent(
        resolve(ROOT, `artifacts/${category}/plain.txt`),
        'plain text',
        { category },
      );
      expect(
        result.encryptionKeyHex,
        `category=${category} should NOT default-encrypt`,
      ).toBeUndefined();
      const [, writtenContent, writeOptions] = vi.mocked(writeFile).mock.calls[0]!;
      expect(writeOptions, `category=${category} should write without mode`).toBeUndefined();
      expect(writtenContent, `category=${category} content`).toEqual(
        Buffer.from('plain text', 'utf8'),
      );
    }
  });

  it('keeps heap-snapshots plaintext for Chrome DevTools Memory panel compatibility', async () => {
    const result = await writeArtifactContent(
      resolve(ROOT, 'artifacts/heap-snapshots/snap.heapsnapshot'),
      'binary heap data',
      { category: 'heap-snapshots' },
    );
    expect(result.encryptionKeyHex).toBeUndefined();
    const [, writtenContent, writeOptions] = vi.mocked(writeFile).mock.calls[0]!;
    expect(writeOptions).toBeUndefined();
    expect(writtenContent).toEqual(Buffer.from('binary heap data', 'utf8'));
  });

  it('allows explicit encrypt:false to opt out of default encryption on sensitive category', async () => {
    const result = await writeArtifactContent(
      resolve(ROOT, 'artifacts/dumps/override.bin'),
      'overridden',
      { category: 'dumps', encrypt: false },
    );
    expect(result.encryptionKeyHex).toBeUndefined();
    const [, writtenContent, writeOptions] = vi.mocked(writeFile).mock.calls[0]!;
    expect(writeOptions).toBeUndefined();
    expect(writtenContent).toEqual(Buffer.from('overridden', 'utf8'));
  });
});
