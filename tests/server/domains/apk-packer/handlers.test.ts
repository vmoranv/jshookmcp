/**
 * Tests for ApkPackerHandlers — the domain handler that wraps the
 * PackerDetector module behind the MCP tool surface.
 *
 * Uses temporary directories with empty `.so` files; no real APK is
 * required. The framework ships no built-in signatures; tests supply
 * customSignatures via the tool input.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ApkPackerHandlers } from '@server/domains/apk-packer/handlers';
import { R } from '@server/domains/shared/ResponseBuilder';

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'apk-packer-handler-'));
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

const PACKER_A_SIG = {
  name: 'PackerA',
  category: 'category-a',
  libPatterns: ['libpacka.so'],
} as const;

describe('ApkPackerHandlers.handleApkPackerDetect — happy paths', () => {
  it('detects a packer from an unpacked dir using customSignatures', async () => {
    const handlers = new ApkPackerHandlers();
    const dirPath = await makeApkDir({ 'arm64-v8a': ['libpacka.so'] });
    const response = await handlers.handleApkPackerDetect({
      dirPath,
      customSignatures: [PACKER_A_SIG],
      ruleMode: 'replace',
    });
    const body = R.parse<{
      success: boolean;
      packers: Array<{ name: string }>;
      layerCount: number;
      confidence: number;
    }>(response);
    expect(body.success).toBe(true);
    expect(body.layerCount).toBe(1);
    expect(body.packers[0]!.name).toBe('PackerA');
    expect(body.confidence).toBeGreaterThan(0);
  });

  it('returns layerCount=0 for a clean app', async () => {
    const handlers = new ApkPackerHandlers();
    const dirPath = await makeApkDir({ 'arm64-v8a': ['libapp.so', 'libflutter.so'] });
    const response = await handlers.handleApkPackerDetect({
      dirPath,
      customSignatures: [PACKER_A_SIG],
      ruleMode: 'replace',
    });
    const body = R.parse<{ success: boolean; packers: unknown[]; layerCount: number }>(response);
    expect(body.success).toBe(true);
    expect(body.layerCount).toBe(0);
    expect(body.packers).toHaveLength(0);
  });

  it('accepts two customSignatures and reports both matches', async () => {
    const handlers = new ApkPackerHandlers();
    const dirPath = await makeApkDir({ 'arm64-v8a': ['libpacka.so', 'libcustom.so'] });
    const response = await handlers.handleApkPackerDetect({
      dirPath,
      ruleMode: 'replace',
      customSignatures: [
        PACKER_A_SIG,
        { name: 'MyCustom', category: 'Acme', libPatterns: ['libcustom.so'] },
      ],
    });
    const body = R.parse<{
      success: boolean;
      packers: Array<{ name: string }>;
      layerCount: number;
    }>(response);
    expect(body.success).toBe(true);
    expect(body.layerCount).toBe(2);
    expect(body.packers.map((p) => p.name).toSorted()).toEqual(['MyCustom', 'PackerA'].toSorted());
  });
});

describe('ApkPackerHandlers.handleApkPackerDetect — validation errors', () => {
  it('returns failure when neither apkPath nor dirPath provided', async () => {
    const handlers = new ApkPackerHandlers();
    const response = await handlers.handleApkPackerDetect({});
    const body = R.parse<{ success: boolean; error: string }>(response);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/apkPath|dirPath/);
  });

  it('returns failure when both apkPath and dirPath provided', async () => {
    const handlers = new ApkPackerHandlers();
    const response = await handlers.handleApkPackerDetect({
      apkPath: '/tmp/a.apk',
      dirPath: '/tmp/b',
    });
    const body = R.parse<{ success: boolean; error: string }>(response);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/both|only one/i);
  });

  it('returns NOT_FOUND failure when apk path does not exist', async () => {
    const handlers = new ApkPackerHandlers();
    const response = await handlers.handleApkPackerDetect({
      apkPath: join(workDir, 'missing.apk'),
    });
    const body = R.parse<{ success: boolean; error: string }>(response);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/not found|ENOENT/i);
  });

  it('rejects customSignatures with ReDoS-shaped pattern', async () => {
    const handlers = new ApkPackerHandlers();
    const dirPath = await makeApkDir({ 'arm64-v8a': ['libapp.so'] });
    const response = await handlers.handleApkPackerDetect({
      dirPath,
      customSignatures: [{ name: 'evil', category: 'attacker', libPatterns: ['^(a+)+$'] }],
    });
    const body = R.parse<{ success: boolean; error: string }>(response);
    expect(body.success).toBe(false);
    expect(body.error.toLowerCase()).toContain('catastrophic');
  });

  it('accepts customSignatures with malformed shape (missing libPatterns)', async () => {
    const handlers = new ApkPackerHandlers();
    const dirPath = await makeApkDir({ 'arm64-v8a': ['libapp.so'] });
    const response = await handlers.handleApkPackerDetect({
      dirPath,
      customSignatures: [{ name: 'oops' }],
    });
    const body = R.parse<{ success: boolean; error: string }>(response);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/libPatterns/i);
  });
});

describe('ApkPackerHandlers.handleApkPackerListSignatures', () => {
  it('returns the empty default signature table with no args', async () => {
    const handlers = new ApkPackerHandlers();
    const response = await handlers.handleApkPackerListSignatures({});
    const body = R.parse<{
      success: boolean;
      signatures: Array<{ name: string; category?: string; libPatterns: unknown[] }>;
    }>(response);
    expect(body.success).toBe(true);
    expect(body.signatures).toHaveLength(0);
  });

  it('still returns an empty list when filtered by any category', async () => {
    const handlers = new ApkPackerHandlers();
    const response = await handlers.handleApkPackerListSignatures({ category: 'anything' });
    const body = R.parse<{ success: boolean; signatures: unknown[] }>(response);
    expect(body.success).toBe(true);
    expect(body.signatures).toEqual([]);
  });
});
