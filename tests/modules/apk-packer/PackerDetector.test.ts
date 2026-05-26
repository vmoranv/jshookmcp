/**
 * PackerDetector module tests.
 *
 * Uses temporary directories with empty `.so` files to exercise the
 * filename-matching logic — no real APK binaries are required.
 *
 * Each documented packer gets at least one happy-path case plus a
 * negative case to prove no over-matching.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PackerDetector } from '@modules/apk-packer/PackerDetector';
import { compileSignatureInput } from '@modules/apk-packer/classifiers';

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'apk-packer-test-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function makeApkDir(libsByAbi: Record<string, string[]>): Promise<string> {
  const root = join(workDir, `apk-${Math.random().toString(36).slice(2)}`);
  await mkdir(root);
  for (const [abi, libs] of Object.entries(libsByAbi)) {
    const abiDir = join(root, 'lib', abi);
    await mkdir(abiDir, { recursive: true });
    for (const lib of libs) {
      await writeFile(join(abiDir, lib), '');
    }
  }
  return root;
}

describe('PackerDetector.detectFromDir - basic matching', () => {
  function sig(name: string, libPatterns: string[], category?: string) {
    return compileSignatureInput({ name, libPatterns, ...(category ? { category } : {}) });
  }

  it('matches a literal lib filename from a custom signature', async () => {
    const dir = await makeApkDir({ 'arm64-v8a': ['libtestguarda.so'] });
    const result = await new PackerDetector().detectFromDir(dir, {
      customSignatures: [sig('TestSignatureA', ['libtestguarda.so'], 'native-wrapper')],
    });
    expect(result.layerCount).toBe(1);
    expect(result.packers[0]!.name).toBe('TestSignatureA');
    expect(result.packers[0]!.matchedLibs).toContain('lib/arm64-v8a/libtestguarda.so');
  });

  it('matches a regex pattern variant', async () => {
    const dir = await makeApkDir({ 'armeabi-v7a': ['libtestguarda_art.so'] });
    const result = await new PackerDetector().detectFromDir(dir, {
      customSignatures: [sig('TestSignatureA', ['^libtestguarda[\\w.-]*\\.so$'])],
    });
    expect(result.layerCount).toBe(1);
    expect(result.packers[0]!.name).toBe('TestSignatureA');
  });

  it('escalates confidence to high when >=2 distinct libs match the same signature', async () => {
    const dir = await makeApkDir({ 'arm64-v8a': ['libtestguardb1.so', 'libtestguardb2.so'] });
    const result = await new PackerDetector().detectFromDir(dir, {
      customSignatures: [sig('TestSignatureB', ['libtestguardb1.so', 'libtestguardb2.so'])],
    });
    expect(result.packers[0]!.name).toBe('TestSignatureB');
    expect(result.packers[0]!.confidence).toBe('high');
  });
});

describe('PackerDetector.detectFromDir — negative cases', () => {
  const detector = new PackerDetector();

  it('returns zero packers for a clean app (no fingerprinted libs)', async () => {
    const dir = await makeApkDir({
      'arm64-v8a': ['libapp.so', 'libflutter.so', 'libreact.so'],
    });
    const result = await detector.detectFromDir(dir);
    expect(result.layerCount).toBe(0);
    expect(result.packers).toHaveLength(0);
    expect(result.confidence).toBe(0);
  });

  it('returns zero packers for an empty lib/ dir', async () => {
    const dir = await makeApkDir({ 'arm64-v8a': [] });
    const result = await detector.detectFromDir(dir);
    expect(result.layerCount).toBe(0);
  });

  it('returns zero packers when no lib/ directory exists', async () => {
    const dir = await mkdtemp(join(workDir, 'no-lib-'));
    const result = await detector.detectFromDir(dir);
    expect(result.layerCount).toBe(0);
  });

  it('does not false-positive on substring filenames (e.g. mylibtestguarda.so)', async () => {
    const dir = await makeApkDir({ 'arm64-v8a': ['mylibtestguarda.so', 'libtestguardaa.so.foo'] });
    const result = await detector.detectFromDir(dir, {
      customSignatures: [
        compileSignatureInput({ name: 'TestSignatureA', libPatterns: ['libtestguarda.so'] }),
      ],
    });
    expect(result.layerCount).toBe(0);
  });
});

describe('PackerDetector.detectFromDir — multi-layer protection', () => {
  const detector = new PackerDetector();

  it('detects two distinct signatures stacked in the same APK', async () => {
    const dir = await makeApkDir({
      'arm64-v8a': ['libtestguarda.so', 'libtestguardb.so'],
    });
    const result = await detector.detectFromDir(dir, {
      customSignatures: [
        compileSignatureInput({ name: 'TestSignatureA', libPatterns: ['libtestguarda.so'] }),
        compileSignatureInput({ name: 'TestSignatureB', libPatterns: ['libtestguardb.so'] }),
      ],
    });
    expect(result.layerCount).toBe(2);
    expect(result.packers.map((p) => p.name).toSorted()).toEqual(
      ['TestSignatureA', 'TestSignatureB'].toSorted(),
    );
    expect(result.confidence).toBeGreaterThanOrEqual(0.75);
  });
});

describe('PackerDetector.detectFromDir — customSignatures', () => {
  const detector = new PackerDetector();

  it('append mode keeps both defaults and custom (defaults are empty here)', async () => {
    const custom = compileSignatureInput({
      name: 'CustomGuard',
      libPatterns: ['libcustomguard.so'],
    });
    const dir = await makeApkDir({ 'arm64-v8a': ['libcustomguard.so'] });
    const result = await detector.detectFromDir(dir, {
      customSignatures: [custom],
      ruleMode: 'append',
    });
    expect(result.packers.map((p) => p.name)).toEqual(['CustomGuard']);
  });

  it('replace mode drops defaults entirely', async () => {
    const custom = compileSignatureInput({
      name: 'CustomOnly',
      libPatterns: ['libcustom.so'],
    });
    const dir = await makeApkDir({ 'arm64-v8a': ['libcustom.so'] });
    const result = await detector.detectFromDir(dir, {
      customSignatures: [custom],
      ruleMode: 'replace',
    });
    expect(result.packers).toHaveLength(1);
    expect(result.packers[0]!.name).toBe('CustomOnly');
  });

  it('regex custom signatures match across abi dirs', async () => {
    const custom = compileSignatureInput({
      name: 'RegexGuard',
      libPatterns: ['^libregex[\\w.-]+\\.so$'],
    });
    const dir = await makeApkDir({ 'arm64-v8a': ['libregex123.so'] });
    const result = await detector.detectFromDir(dir, {
      customSignatures: [custom],
      ruleMode: 'replace',
    });
    expect(result.packers).toHaveLength(1);
    expect(result.packers[0]!.name).toBe('RegexGuard');
  });
});

describe('PackerDetector.detectFromDir — validation errors', () => {
  const detector = new PackerDetector();

  it('throws VALIDATION for empty dirPath', async () => {
    await expect(detector.detectFromDir('')).rejects.toThrowError(
      expect.objectContaining({ name: 'ToolError', code: 'VALIDATION' }),
    );
  });

  it('throws NOT_FOUND for missing path', async () => {
    await expect(detector.detectFromDir(join(workDir, 'does-not-exist'))).rejects.toThrowError(
      expect.objectContaining({ name: 'ToolError', code: 'NOT_FOUND' }),
    );
  });
});

describe('PackerDetector.detectFromApk — basic ZIP path', () => {
  const detector = new PackerDetector();

  it('throws NOT_FOUND for missing apk path', async () => {
    await expect(detector.detectFromApk(join(workDir, 'missing.apk'))).rejects.toThrowError(
      expect.objectContaining({ name: 'ToolError', code: 'NOT_FOUND' }),
    );
  });

  it('throws VALIDATION when apkPath is a directory', async () => {
    await expect(detector.detectFromApk(workDir)).rejects.toThrowError(
      expect.objectContaining({ name: 'ToolError', code: 'VALIDATION' }),
    );
  });

  it('throws VALIDATION when file is not a valid ZIP', async () => {
    const notZip = join(workDir, 'fake.apk');
    await writeFile(notZip, 'this is plain text, not a zip');
    await expect(detector.detectFromApk(notZip)).rejects.toThrowError(
      expect.objectContaining({ name: 'ToolError', code: 'VALIDATION' }),
    );
  });
});
