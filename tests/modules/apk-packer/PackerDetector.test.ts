/**
 * PackerDetector module tests.
 *
 * Uses temporary directories with empty `.so` files to exercise the
 * filename-matching logic — no real APK binaries are required.
 *
 * The framework ships no built-in signatures; every test supplies its own
 * customSignatures via `compileSignatureInput`.
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

const SIG_A = compileSignatureInput({
  name: 'PackerA',
  category: 'category-a',
  libPatterns: ['libpacka.so', '^libpacka_[\\w.-]+\\.so$'],
});
const SIG_B = compileSignatureInput({
  name: 'PackerB',
  category: 'category-b',
  libPatterns: ['libpackb_main.so', 'libpackb_runtime.so'],
});

describe('PackerDetector.detectFromDir — happy paths', () => {
  const detector = new PackerDetector();

  it('detects PackerA via literal libpacka.so', async () => {
    const dir = await makeApkDir({ 'arm64-v8a': ['libpacka.so'] });
    const result = await detector.detectFromDir(dir, {
      customSignatures: [SIG_A],
      ruleMode: 'replace',
    });
    expect(result.layerCount).toBe(1);
    expect(result.packers[0]!.name).toBe('PackerA');
    expect(result.packers[0]!.matchedLibs).toContain('lib/arm64-v8a/libpacka.so');
  });

  it('detects PackerA variant via regex (libpacka_v2.so)', async () => {
    const dir = await makeApkDir({ 'arm64-v8a': ['libpacka_v2.so'] });
    const result = await detector.detectFromDir(dir, {
      customSignatures: [SIG_A],
      ruleMode: 'replace',
    });
    expect(result.packers[0]!.name).toBe('PackerA');
  });

  it('escalates to high confidence when ≥2 matching libs hit', async () => {
    const dir = await makeApkDir({ 'arm64-v8a': ['libpackb_main.so', 'libpackb_runtime.so'] });
    const result = await detector.detectFromDir(dir, {
      customSignatures: [SIG_B],
      ruleMode: 'replace',
    });
    expect(result.packers[0]!.name).toBe('PackerB');
    expect(result.packers[0]!.confidence).toBe('high');
  });
});

describe('PackerDetector.detectFromDir — negative cases', () => {
  const detector = new PackerDetector();

  it('returns zero packers when no signature matches', async () => {
    const dir = await makeApkDir({
      'arm64-v8a': ['libapp.so', 'libflutter.so', 'libreact.so'],
    });
    const result = await detector.detectFromDir(dir, {
      customSignatures: [SIG_A, SIG_B],
      ruleMode: 'replace',
    });
    expect(result.layerCount).toBe(0);
    expect(result.packers).toHaveLength(0);
    expect(result.confidence).toBe(0);
  });

  it('returns zero packers for an empty lib/ dir', async () => {
    const dir = await makeApkDir({ 'arm64-v8a': [] });
    const result = await detector.detectFromDir(dir, {
      customSignatures: [SIG_A],
      ruleMode: 'replace',
    });
    expect(result.layerCount).toBe(0);
  });

  it('returns zero packers when no lib/ directory exists', async () => {
    const dir = await mkdtemp(join(workDir, 'no-lib-'));
    const result = await detector.detectFromDir(dir, {
      customSignatures: [SIG_A],
      ruleMode: 'replace',
    });
    expect(result.layerCount).toBe(0);
  });

  it('does not false-positive on substring filenames (e.g. mylibpacka.so)', async () => {
    const dir = await makeApkDir({ 'arm64-v8a': ['mylibpacka.so', 'libpackaxx.so.foo'] });
    const result = await detector.detectFromDir(dir, {
      customSignatures: [SIG_A],
      ruleMode: 'replace',
    });
    expect(result.layerCount).toBe(0);
  });
});

describe('PackerDetector.detectFromDir — multi-layer detection', () => {
  const detector = new PackerDetector();

  it('detects two distinct packers stacked in the same APK', async () => {
    const dir = await makeApkDir({
      'arm64-v8a': ['libpacka.so', 'libpackb_main.so'],
    });
    const result = await detector.detectFromDir(dir, {
      customSignatures: [SIG_A, SIG_B],
      ruleMode: 'replace',
    });
    expect(result.layerCount).toBe(2);
    expect(result.packers.map((p) => p.name).toSorted()).toEqual(['PackerA', 'PackerB'].toSorted());
    expect(result.confidence).toBeGreaterThanOrEqual(0.75);
  });
});

describe('PackerDetector.detectFromDir — customSignatures', () => {
  const detector = new PackerDetector();

  it('appends custom signature in append mode (default keeps both)', async () => {
    const custom = compileSignatureInput({
      name: 'CustomGuard',
      category: 'Acme',
      libPatterns: ['libcustomguard.so'],
    });
    const dir = await makeApkDir({ 'arm64-v8a': ['libcustomguard.so', 'libpacka.so'] });
    const result = await detector.detectFromDir(dir, {
      customSignatures: [SIG_A, custom],
      ruleMode: 'replace',
    });
    const names = result.packers.map((p) => p.name).toSorted();
    expect(names).toEqual(['CustomGuard', 'PackerA'].toSorted());
  });

  it('replace mode drops defaults entirely', async () => {
    const custom = compileSignatureInput({
      name: 'CustomOnly',
      category: 'Acme',
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
      category: 'Acme',
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
