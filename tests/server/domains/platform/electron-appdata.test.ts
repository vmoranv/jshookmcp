import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleElectronScanUserdata } from '@server/domains/platform/handlers/electron-userdata-handler';

describe('electron_scan_userdata', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'appdata-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should scan directory with JSON files and return raw content', async () => {
    const config = { key: 'value', nested: { deep: true } };
    const settings = { theme: 'dark', version: 3 };
    await writeFile(join(tempDir, 'config.json'), JSON.stringify(config));
    await writeFile(join(tempDir, 'settings.json'), JSON.stringify(settings));

    const result = await handleElectronScanUserdata({ dirPath: tempDir });
    const data = JSON.parse(result.content[0]!.text!);

    expect(data.success).toBe(true);
    expect(data.files).toHaveLength(2);
    expect(data.files[0].name).toMatch(/\.json$/);
    expect(data.files[0].content).toBeDefined();
    expect(data.totalScanned).toBe(2);
  });

  it('should return success:false for non-existent directory', async () => {
    const result = await handleElectronScanUserdata({
      dirPath: join(tempDir, 'does-not-exist'),
    });
    const data = JSON.parse(result.content[0]!.text!);
    expect(data.success).toBe(false);
  });

  it('should respect maxFiles limit', async () => {
    await writeFile(join(tempDir, 'a.json'), '{"a":1}');
    await writeFile(join(tempDir, 'b.json'), '{"b":2}');
    await writeFile(join(tempDir, 'c.json'), '{"c":3}');

    const result = await handleElectronScanUserdata({
      dirPath: tempDir,
      maxFiles: 1,
    });
    const data = JSON.parse(result.content[0]!.text!);

    expect(data.success).toBe(true);
    expect(data.files).toHaveLength(1);
  });

  it('should skip files exceeding maxFileSizeKB', async () => {
    // Create a JSON file larger than 1KB
    const largeContent = JSON.stringify({ data: 'x'.repeat(2000) });
    await writeFile(join(tempDir, 'large.json'), largeContent);
    await writeFile(join(tempDir, 'small.json'), '{"s":1}');

    const result = await handleElectronScanUserdata({
      dirPath: tempDir,
      maxFileSizeKB: 1,
    });
    const data = JSON.parse(result.content[0]!.text!);

    expect(data.success).toBe(true);
    const fileNames = data.files.map((f: { name: string }) => f.name);
    const skippedNames = data.skipped.map((f: { name: string }) => f.name);
    expect(fileNames).toContain('small.json');
    expect(skippedNames).toContain('large.json');
  });

  it('should ignore non-JSON files', async () => {
    await writeFile(join(tempDir, 'readme.txt'), 'hello');
    await writeFile(join(tempDir, 'data.json'), '{"ok":true}');
    await writeFile(join(tempDir, 'script.js'), 'console.log()');

    const result = await handleElectronScanUserdata({ dirPath: tempDir });
    const data = JSON.parse(result.content[0]!.text!);

    expect(data.success).toBe(true);
    expect(data.files).toHaveLength(1);
    expect(data.files[0].name).toBe('data.json');
  });
});
