import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  handleElectronCheckFuses,
  handleElectronPatchFuses,
} from '@server/domains/platform/handlers/electron-fuse-handler';

/** Build a minimal mock Electron .exe with the fuse sentinel embedded. */
function buildMockElectronExe(fuseBytes: number[]): Buffer {
  const sentinel = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZIA', 'ascii');
  const prefix = Buffer.alloc(256, 0x90); // NOP sled padding
  const fuses = Buffer.from(fuseBytes);
  return Buffer.concat([prefix, sentinel, fuses]);
}

type JsonPayload = Record<string, unknown>;

function parse(result: { content: Array<{ text?: string }> }): JsonPayload {
  return JSON.parse(result.content[0]!.text!) as JsonPayload;
}

describe('electron_patch_fuses', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'fuse-patch-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should patch debug fuses with debug profile', async () => {
    // All fuses DISABLED (0x30)
    const exe = buildMockElectronExe([0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30]);
    const exePath = join(tempDir, 'app.exe');
    await writeFile(exePath, exe);

    const result = parse(await handleElectronPatchFuses({ exePath, profile: 'debug' }));

    expect(result.success).toBe(true);
    expect(result.backupPath).toBe(`${exePath}.bak`);
    expect(Array.isArray(result.changes)).toBe(true);
    const changes = result.changes as Array<{ fuse: string; before: string; after: string }>;
    expect(changes.length).toBeGreaterThan(0);

    // Verify the binary was actually patched
    const patched = await readFile(exePath);
    const sentinel = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZIA', 'ascii');
    const idx = patched.indexOf(sentinel);
    const fuseStart = idx + sentinel.length;

    // RunAsNode (idx 0) should now be ENABLE (0x31)
    expect(patched[fuseStart]).toBe(0x31);
    // EnableNodeOptionsEnvironmentVariable (idx 2) should be ENABLE
    expect(patched[fuseStart + 2]).toBe(0x31);
    // EnableNodeCliInspectArguments (idx 3) should be ENABLE
    expect(patched[fuseStart + 3]).toBe(0x31);
    // OnlyLoadAppFromAsar (idx 5) should be DISABLE (0x30)
    expect(patched[fuseStart + 5]).toBe(0x30);
  });

  it('should create backup before patching', async () => {
    const exe = buildMockElectronExe([0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30]);
    const exePath = join(tempDir, 'app.exe');
    await writeFile(exePath, exe);

    await handleElectronPatchFuses({ exePath, profile: 'debug' });

    const backup = await readFile(`${exePath}.bak`);
    // Backup should have the original DISABLE values
    const sentinel = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZIA', 'ascii');
    const idx = backup.indexOf(sentinel);
    expect(backup[idx + sentinel.length]).toBe(0x30); // original DISABLE
  });

  it('should skip backup when createBackup=false', async () => {
    const exe = buildMockElectronExe([0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30]);
    const exePath = join(tempDir, 'app.exe');
    await writeFile(exePath, exe);

    const result = parse(
      await handleElectronPatchFuses({
        exePath,
        profile: 'debug',
        createBackup: false,
      }),
    );

    expect(result.success).toBe(true);
    expect(result.backupPath).toBeNull();
  });

  it('should not patch REMOVED fuses', async () => {
    // RunAsNode = REMOVED (0x72)
    const exe = buildMockElectronExe([0x72, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30]);
    const exePath = join(tempDir, 'app.exe');
    await writeFile(exePath, exe);

    const result = parse(await handleElectronPatchFuses({ exePath, profile: 'debug' }));
    expect(result.success).toBe(true);
    const changes = result.changes as Array<{ fuse: string; after: string }>;
    const runAsNode = changes.find((c) => c.fuse === 'RunAsNode');
    expect(runAsNode?.after).toContain('cannot patch');
  });

  it('should report no changes if already in desired state', async () => {
    // All debug fuses already enabled, OnlyLoadAppFromAsar already disabled
    const exe = buildMockElectronExe([0x31, 0x30, 0x31, 0x31, 0x30, 0x30, 0x30, 0x30]);
    const exePath = join(tempDir, 'app.exe');
    await writeFile(exePath, exe);

    const result = parse(await handleElectronPatchFuses({ exePath, profile: 'debug' }));
    expect(result.success).toBe(true);
    expect(result.message).toContain('already in the desired state');
  });

  it('should patch custom fuses with custom profile', async () => {
    const exe = buildMockElectronExe([0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30]);
    const exePath = join(tempDir, 'app.exe');
    await writeFile(exePath, exe);

    const result = parse(
      await handleElectronPatchFuses({
        exePath,
        profile: 'custom',
        fuses: { EnableCookieEncryption: 'ENABLE' },
      }),
    );

    expect(result.success).toBe(true);
    const changes = result.changes as Array<{ fuse: string; after: string }>;
    expect(changes.length).toBe(1);
    expect(changes[0]!.fuse).toBe('EnableCookieEncryption');
  });

  it('should error on non-existent file', async () => {
    const result = parse(
      await handleElectronPatchFuses({
        exePath: join(tempDir, 'missing.exe'),
      }),
    );
    expect(result.success).toBe(false);
  });

  it('should error on non-Electron binary', async () => {
    const plainFile = Buffer.alloc(512, 0x00);
    const filePath = join(tempDir, 'plain.exe');
    await writeFile(filePath, plainFile);

    const result = parse(await handleElectronPatchFuses({ exePath: filePath }));
    expect(result.success).toBe(false);
    expect(result.error).toContain('No fuse sentinel');
  });

  it('should reject unknown profile', async () => {
    const exe = buildMockElectronExe([0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30]);
    const exePath = join(tempDir, 'app.exe');
    await writeFile(exePath, exe);

    const result = parse(await handleElectronPatchFuses({ exePath, profile: 'badprofile' }));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown profile');
  });

  // Ensure existing check_fuses still works after handler rewrite
  it('check_fuses should still detect fuses correctly', async () => {
    const exe = buildMockElectronExe([0x31, 0x30, 0x31, 0x30, 0x72, 0x31, 0x30, 0x31]);
    const exePath = join(tempDir, 'app.exe');
    await writeFile(exePath, exe);

    const result = parse(await handleElectronCheckFuses({ exePath }));
    expect(result.success).toBe(true);
    expect(result.fuseWireFound).toBe(true);
    const fuses = result.fuses as Record<string, string>;
    expect(fuses.RunAsNode).toBe('ENABLE');
    expect(fuses.EnableCookieEncryption).toBe('DISABLE');
    expect(fuses.EnableEmbeddedAsarIntegrityValidation).toBe('REMOVED');
  });
});
