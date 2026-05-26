/**
 * Tests for ApkPackerHandlers — the domain handler that wraps the
 * PackerDetector module behind the MCP tool surface.
 *
 * Uses temporary directories with empty `.so` files; no real APK is
 * required. The handler returns a wrapped ToolResponse, so tests parse
 * the response via R.parse before asserting.
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

describe('ApkPackerHandlers.handleApkPackerDetect — happy paths', () => {
  it('detects a custom signature from an unpacked dir', async () => {
    const handlers = new ApkPackerHandlers();
    const dirPath = await makeApkDir({ 'arm64-v8a': ['libtestguarda.so'] });
    const response = await handlers.handleApkPackerDetect({
      dirPath,
      customSignatures: [
        { name: 'TestSignatureA', libPatterns: ['libtestguarda.so'], category: 'native-wrapper' },
      ],
    });
    const body = R.parse<{
      success: boolean;
      packers: Array<{ name: string }>;
      layerCount: number;
      confidence: number;
    }>(response);
    expect(body.success).toBe(true);
    expect(body.layerCount).toBe(1);
    expect(body.packers[0]!.name).toBe('TestSignatureA');
    expect(body.confidence).toBeGreaterThan(0);
  });

  it('returns layerCount=0 for a clean app', async () => {
    const handlers = new ApkPackerHandlers();
    const dirPath = await makeApkDir({ 'arm64-v8a': ['libapp.so', 'libflutter.so'] });
    const response = await handlers.handleApkPackerDetect({ dirPath });
    const body = R.parse<{ success: boolean; packers: unknown[]; layerCount: number }>(response);
    expect(body.success).toBe(true);
    expect(body.layerCount).toBe(0);
    expect(body.packers).toHaveLength(0);
  });

  it('accepts customSignatures replace mode', async () => {
    const handlers = new ApkPackerHandlers();
    const dirPath = await makeApkDir({ 'arm64-v8a': ['libcustom.so'] });
    const response = await handlers.handleApkPackerDetect({
      dirPath,
      ruleMode: 'replace',
      customSignatures: [{ name: 'MyCustom', libPatterns: ['libcustom.so'] }],
    });
    const body = R.parse<{
      success: boolean;
      packers: Array<{ name: string }>;
      layerCount: number;
    }>(response);
    expect(body.success).toBe(true);
    expect(body.layerCount).toBe(1);
    expect(body.packers[0]!.name).toBe('MyCustom');
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
      customSignatures: [{ name: 'evil', libPatterns: ['^(a+)+$'] }],
    });
    const body = R.parse<{ success: boolean; error: string }>(response);
    expect(body.success).toBe(false);
    expect(body.error.toLowerCase()).toContain('catastrophic');
  });

  it('rejects customSignatures with malformed shape (missing name)', async () => {
    const handlers = new ApkPackerHandlers();
    const dirPath = await makeApkDir({ 'arm64-v8a': ['libapp.so'] });
    const response = await handlers.handleApkPackerDetect({
      dirPath,
      customSignatures: [{ libPatterns: ['libfoo.so'] }],
    });
    const body = R.parse<{ success: boolean; error: string }>(response);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/name/i);
  });
});

describe('ApkPackerHandlers.handleApkPackerListSignatures', () => {
  it('returns an empty signature table (framework ships none by default)', async () => {
    const handlers = new ApkPackerHandlers();
    const response = await handlers.handleApkPackerListSignatures({});
    const body = R.parse<{ success: boolean; signatures: unknown[] }>(response);
    expect(body.success).toBe(true);
    expect(body.signatures).toEqual([]);
  });

  it('returns an empty list for any category filter (default table is empty)', async () => {
    const handlers = new ApkPackerHandlers();
    const response = await handlers.handleApkPackerListSignatures({ category: 'native-wrapper' });
    const body = R.parse<{ success: boolean; signatures: unknown[] }>(response);
    expect(body.success).toBe(true);
    expect(body.signatures).toEqual([]);
  });
});
