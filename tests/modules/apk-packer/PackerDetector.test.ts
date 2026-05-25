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

describe('PackerDetector.detectFromDir — happy paths per vendor', () => {
  const detector = new PackerDetector();

  it('detects Qihoo 360 Jiagu via libjiagu.so', async () => {
    const dir = await makeApkDir({ 'arm64-v8a': ['libjiagu.so'] });
    const result = await detector.detectFromDir(dir);
    expect(result.layerCount).toBe(1);
    expect(result.packers[0]!.name).toBe('Qihoo 360 Jiagu');
    expect(result.packers[0]!.matchedLibs).toContain('lib/arm64-v8a/libjiagu.so');
  });

  it('detects Jiagu variant via regex (libjiagu_art.so)', async () => {
    const dir = await makeApkDir({ 'armeabi-v7a': ['libjiagu_art.so'] });
    const result = await detector.detectFromDir(dir);
    expect(result.packers[0]!.name).toBe('Qihoo 360 Jiagu');
  });

  it('detects Tencent Legu via libshell.so', async () => {
    const dir = await makeApkDir({ 'arm64-v8a': ['libshell.so'] });
    const result = await detector.detectFromDir(dir);
    expect(result.packers[0]!.name).toBe('Tencent Legu');
  });

  it('detects Tencent Legu via libshella-{ver}.so', async () => {
    const dir = await makeApkDir({ 'arm64-v8a': ['libshella-2.10.7.0.so'] });
    const result = await detector.detectFromDir(dir);
    expect(result.packers[0]!.name).toBe('Tencent Legu');
  });

  it('detects Tencent TMP via libtup.so', async () => {
    const dir = await makeApkDir({ 'arm64-v8a': ['libtup.so'] });
    const result = await detector.detectFromDir(dir);
    expect(result.packers[0]!.name).toBe('Tencent TMP / YuanShield');
  });

  it('detects Bangcle via libsecexe.so + libsecmain.so (escalates to high)', async () => {
    const dir = await makeApkDir({ 'arm64-v8a': ['libsecexe.so', 'libsecmain.so'] });
    const result = await detector.detectFromDir(dir);
    expect(result.packers[0]!.name).toBe('Bangcle / SecNeo');
    expect(result.packers[0]!.confidence).toBe('high');
  });

  it('detects Ijiami via libexec.so', async () => {
    const dir = await makeApkDir({ 'arm64-v8a': ['libexec.so'] });
    const result = await detector.detectFromDir(dir);
    expect(result.packers[0]!.name).toBe('Ijiami / 爱加密');
  });

  it('detects Baidu via libbaiduprotect.so', async () => {
    const dir = await makeApkDir({ 'arm64-v8a': ['libbaiduprotect.so'] });
    const result = await detector.detectFromDir(dir);
    expect(result.packers[0]!.name).toBe('Baidu Protection');
  });

  it('detects Alibaba JuAnQuan via libmobisec.so', async () => {
    const dir = await makeApkDir({ 'arm64-v8a': ['libmobisec.so'] });
    const result = await detector.detectFromDir(dir);
    expect(result.packers[0]!.name).toBe('Alibaba JuAnQuan');
  });

  it('detects NetEase Yidun via libnesec.so', async () => {
    const dir = await makeApkDir({ 'arm64-v8a': ['libnesec.so'] });
    const result = await detector.detectFromDir(dir);
    expect(result.packers[0]!.name).toBe('NetEase Yidun');
  });

  it('detects DexGuard via libdexguard.so', async () => {
    const dir = await makeApkDir({ 'arm64-v8a': ['libdexguard.so'] });
    const result = await detector.detectFromDir(dir);
    expect(result.packers[0]!.name).toBe('DexGuard');
  });

  it('detects DexProtector via libdexprotector.so', async () => {
    const dir = await makeApkDir({ 'arm64-v8a': ['libdexprotector.so'] });
    const result = await detector.detectFromDir(dir);
    expect(result.packers[0]!.name).toBe('DexProtector');
  });

  it('detects AppSealing via libcovault-appsec.so', async () => {
    const dir = await makeApkDir({ 'arm64-v8a': ['libcovault-appsec.so'] });
    const result = await detector.detectFromDir(dir);
    expect(result.packers[0]!.name).toBe('AppSealing');
  });

  it('detects Virbox via libvmp_{ver}.so + libccg.so (high confidence)', async () => {
    const dir = await makeApkDir({ 'arm64-v8a': ['libvmp_1.0.0.so', 'libccg.so'] });
    const result = await detector.detectFromDir(dir);
    expect(result.packers[0]!.name).toBe('Virbox Protector');
    expect(result.packers[0]!.confidence).toBe('high');
  });

  it('detects ApkProtect via libapkprotect.so', async () => {
    const dir = await makeApkDir({ 'arm64-v8a': ['libapkprotect.so'] });
    const result = await detector.detectFromDir(dir);
    expect(result.packers[0]!.name).toBe('ApkProtect');
  });

  it('detects Naga via libchaosvmp.so', async () => {
    const dir = await makeApkDir({ 'arm64-v8a': ['libchaosvmp.so'] });
    const result = await detector.detectFromDir(dir);
    expect(result.packers[0]!.name).toBe('Naga Protect');
  });

  it('detects Kiwi via libkdp.so', async () => {
    const dir = await makeApkDir({ 'arm64-v8a': ['libkdp.so'] });
    const result = await detector.detectFromDir(dir);
    expect(result.packers[0]!.name).toBe('Kiwi (KDP)');
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

  it('does not false-positive on substring filenames (e.g. mylibshell.so)', async () => {
    const dir = await makeApkDir({ 'arm64-v8a': ['mylibshell.so', 'libshellxx.so.foo'] });
    const result = await detector.detectFromDir(dir);
    expect(result.layerCount).toBe(0);
  });
});

describe('PackerDetector.detectFromDir — multi-layer protection', () => {
  const detector = new PackerDetector();

  it('detects two distinct packers stacked in the same APK', async () => {
    const dir = await makeApkDir({
      'arm64-v8a': ['libjiagu.so', 'libshell.so'],
    });
    const result = await detector.detectFromDir(dir);
    expect(result.layerCount).toBe(2);
    expect(result.packers.map((p) => p.name).toSorted()).toEqual(
      ['Qihoo 360 Jiagu', 'Tencent Legu'].toSorted(),
    );
    // Two layers always bumps the aggregate confidence by 0.25.
    expect(result.confidence).toBeGreaterThanOrEqual(0.75);
  });
});

describe('PackerDetector.detectFromDir — customSignatures', () => {
  const detector = new PackerDetector();

  it('appends custom signature in append mode (default keeps both)', async () => {
    const custom = compileSignatureInput({
      name: 'CustomGuard',
      vendor: 'Acme',
      libPatterns: ['libcustomguard.so'],
    });
    const dir = await makeApkDir({ 'arm64-v8a': ['libcustomguard.so', 'libjiagu.so'] });
    const result = await detector.detectFromDir(dir, {
      customSignatures: [custom],
      ruleMode: 'append',
    });
    const names = result.packers.map((p) => p.name).toSorted();
    expect(names).toEqual(['CustomGuard', 'Qihoo 360 Jiagu'].toSorted());
  });

  it('replace mode drops defaults entirely', async () => {
    const custom = compileSignatureInput({
      name: 'CustomOnly',
      vendor: 'Acme',
      libPatterns: ['libcustom.so'],
    });
    const dir = await makeApkDir({ 'arm64-v8a': ['libjiagu.so', 'libcustom.so'] });
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
      vendor: 'Acme',
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
