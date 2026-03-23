import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleElectronCheckFuses } from '@server/domains/platform/handlers/electron-fuse-handler';

/** Build a minimal mock Electron .exe with the fuse sentinel embedded. */
function buildMockElectronExe(fuseBytes: number[]): Buffer {
  const sentinel = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZIA', 'ascii');
  const prefix = Buffer.alloc(256, 0x90); // NOP sled padding
  const fuses = Buffer.from(fuseBytes);
  return Buffer.concat([prefix, sentinel, fuses]);
}

describe('electron_check_fuses', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'fuse-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should detect all-ENABLE fuses', async () => {
    // 8 fuses, all set to 0x31 (ENABLE)
    const exe = buildMockElectronExe([0x31, 0x31, 0x31, 0x31, 0x31, 0x31, 0x31, 0x31]);
    const exePath = join(tempDir, 'test-app.exe');
    await writeFile(exePath, exe);

    const result = await handleElectronCheckFuses({ exePath });
    const data = JSON.parse(result.content[0]!.text!);

    expect(data.success).toBe(true);
    expect(data.fuseWireFound).toBe(true);
    expect(data.fuses.RunAsNode).toBe('ENABLE');
    expect(data.fuses.EnableCookieEncryption).toBe('ENABLE');
    expect(data.fuses.OnlyLoadAppFromAsar).toBe('ENABLE');
  });

  it('should detect mixed fuse states', async () => {
    // ENABLE, DISABLE, ENABLE, DISABLE, REMOVED, ENABLE, DISABLE, ENABLE
    const exe = buildMockElectronExe([0x31, 0x30, 0x31, 0x30, 0x72, 0x31, 0x30, 0x31]);
    const exePath = join(tempDir, 'test-mixed.exe');
    await writeFile(exePath, exe);

    const result = await handleElectronCheckFuses({ exePath });
    const data = JSON.parse(result.content[0]!.text!);

    expect(data.success).toBe(true);
    expect(data.fuseWireFound).toBe(true);
    expect(data.fuses.RunAsNode).toBe('ENABLE');
    expect(data.fuses.EnableCookieEncryption).toBe('DISABLE');
    expect(data.fuses.EnableEmbeddedAsarIntegrityValidation).toBe('REMOVED');
    expect(data.fuses.OnlyLoadAppFromAsar).toBe('ENABLE');
    expect(data.fuses.LoadBrowserProcessSpecificV8Snapshot).toBe('DISABLE');
  });

  it('should return fuseWireFound:false for non-Electron binary', async () => {
    const plainFile = Buffer.alloc(512, 0x00);
    const filePath = join(tempDir, 'plain-app.exe');
    await writeFile(filePath, plainFile);

    const result = await handleElectronCheckFuses({ exePath: filePath });
    const data = JSON.parse(result.content[0]!.text!);

    expect(data.success).toBe(true);
    expect(data.fuseWireFound).toBe(false);
    expect(data.fuses).toEqual({});
  });

  it('should return success:false for non-existent file', async () => {
    const result = await handleElectronCheckFuses({
      exePath: join(tempDir, 'nonexistent.exe'),
    });
    const data = JSON.parse(result.content[0]!.text!);
    expect(data.success).toBe(false);
  });
});
