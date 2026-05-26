/**
 * Integration tests for the apk-packer domain.
 *
 * Verifies the domain is discoverable by the registry, the manifest
 * registrations bind correctly, and the two tools work end-to-end
 * against synthetic temp-dir fixtures. The framework ships no built-in
 * signatures; callers supply customSignatures.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import manifest from '@server/domains/apk-packer/manifest';
import type { MCPServerContext } from '@server/MCPServer.context';
import { R } from '@server/domains/shared/ResponseBuilder';
import { discoverDomainManifests } from '@server/registry/discovery';

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'apk-packer-integration-'));
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

describe('apk-packer integration', () => {
  it('is discoverable by the registry', async () => {
    const manifests = await discoverDomainManifests();
    const found = manifests.find((m) => m.domain === 'apk-packer');
    expect(found).toBeDefined();
    expect(found?.depKey).toBe('apkPackerHandlers');
  });

  it('registry exposes all three apk-packer tools', () => {
    const toolNames = manifest.registrations.map((r) => r.tool.name).toSorted();
    expect(toolNames).toEqual([
      'apk_packer_detect',
      'apk_packer_list_signatures',
      'apk_signing_block_parse',
    ]);
  });

  it('end-to-end: detect via dirPath with customSignatures surfaces matches', async () => {
    const ctx = {} as MCPServerContext;
    const handler = await manifest.ensure(ctx);
    const dirPath = await makeApkDir({ 'arm64-v8a': ['libpacka_main.so', 'libpacka_helper.so'] });
    const response = await handler.handleApkPackerDetect({
      dirPath,
      ruleMode: 'replace',
      customSignatures: [
        {
          name: 'PackerA',
          category: 'category-a',
          libPatterns: ['libpacka_main.so', 'libpacka_helper.so'],
        },
      ],
    });
    const body = R.parse<{
      success: boolean;
      packers: Array<{ name: string; confidence: string }>;
      layerCount: number;
    }>(response);
    expect(body.success).toBe(true);
    expect(body.layerCount).toBe(1);
    expect(body.packers[0]!.name).toBe('PackerA');
    expect(body.packers[0]!.confidence).toBe('high');
  });

  it('end-to-end: list_signatures returns the empty default catalogue', async () => {
    const ctx = {} as MCPServerContext;
    const handler = await manifest.ensure(ctx);
    const response = await handler.handleApkPackerListSignatures({});
    const body = R.parse<{ success: boolean; signatures: unknown[] }>(response);
    expect(body.success).toBe(true);
    expect(body.signatures).toHaveLength(0);
  });

  it('end-to-end: detect with NOT_FOUND apk surfaces error response', async () => {
    const ctx = {} as MCPServerContext;
    const handler = await manifest.ensure(ctx);
    const response = await handler.handleApkPackerDetect({
      apkPath: join(workDir, 'does-not-exist.apk'),
    });
    const body = R.parse<{ success: boolean; error?: string }>(response);
    expect(body.success).toBe(false);
    expect(body.error).toBeDefined();
  });
});
