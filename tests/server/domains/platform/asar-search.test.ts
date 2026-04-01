import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ElectronHandlers } from '@server/domains/platform/handlers/electron-handlers';
import type { CodeCollector } from '@server/domains/shared/modules';

/**
 * Build a minimal ASAR buffer from file entries.
 * ASAR format: [headerSize:u32LE] [headerStringSize:u32LE] [headerContentSize:u32LE] [padding:u32LE] [headerJSON] [data]
 */
function buildMockAsar(entries: Array<{ path: string; content: string }>): Buffer {
  // Build data section
  const dataBuffers: Buffer[] = [];
  const headerFiles: Record<string, unknown> = {};
  let dataOffset = 0;

  for (const entry of entries) {
    const contentBuf = Buffer.from(entry.content, 'utf-8');
    const parts = entry.path.split('/');
    let current = headerFiles;

    for (let i = 0; i < parts.length - 1; i++) {
      const dir = parts[i]!;
      if (!current[dir]) {
        current[dir] = { files: {} };
      }
      current = (current[dir] as Record<string, unknown>).files as Record<string, unknown>;
    }

    const fileName = parts[parts.length - 1]!;
    current[fileName] = {
      size: contentBuf.length,
      offset: String(dataOffset),
    };

    dataBuffers.push(contentBuf);
    dataOffset += contentBuf.length;
  }

  const headerObject = { files: headerFiles };
  const headerJson = JSON.stringify(headerObject);
  const headerBuf = Buffer.from(headerJson, 'utf-8');

  // ASAR header: 4 uint32LE fields
  const headerPrefix = Buffer.alloc(16);
  headerPrefix.writeUInt32LE(headerBuf.length + 8, 0); // headerSize
  headerPrefix.writeUInt32LE(headerBuf.length + 4, 4); // headerStringSize
  headerPrefix.writeUInt32LE(headerBuf.length, 8); // headerContentSize
  headerPrefix.writeUInt32LE(0, 12); // padding

  return Buffer.concat([headerPrefix, headerBuf, ...dataBuffers]);
}

describe('asar_search', () => {
  let tempDir: string;
  let handler: ElectronHandlers;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'asar-search-test-'));
    handler = new ElectronHandlers({} as CodeCollector);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should find matches for a given pattern', async () => {
    const asar = buildMockAsar([
      {
        path: 'src/main.js',
        content: 'const isPro = true;\nconst isFree = false;\n',
      },
      { path: 'src/utils.js', content: 'function helper() { return 1; }\n' },
    ]);
    const asarPath = join(tempDir, 'test.asar');
    await writeFile(asarPath, asar);

    const result = await handler.handleAsarSearch({
      inputPath: asarPath,
      pattern: 'isPro|isFree',
    });
    const data = JSON.parse(result.content[0]!.text!);

    expect(data.success).toBe(true);
    expect(data.totalMatches).toBeGreaterThan(0);
    expect(data.matches.length).toBeGreaterThan(0);
    expect(data.matches[0].filePath).toBe('src/main.js');
  });

  it('should return empty matches for non-matching pattern', async () => {
    const asar = buildMockAsar([{ path: 'src/index.js', content: 'console.log("hello");\n' }]);
    const asarPath = join(tempDir, 'test.asar');
    await writeFile(asarPath, asar);

    const result = await handler.handleAsarSearch({
      inputPath: asarPath,
      pattern: 'nonexistent_pattern_xyz',
    });
    const data = JSON.parse(result.content[0]!.text!);

    expect(data.success).toBe(true);
    expect(data.matches).toHaveLength(0);
    expect(data.totalMatches).toBe(0);
  });

  it('should filter by fileGlob', async () => {
    const asar = buildMockAsar([
      { path: 'config.json', content: '{"isPro": true}\n' },
      { path: 'main.js', content: 'const isPro = true;\n' },
    ]);
    const asarPath = join(tempDir, 'test.asar');
    await writeFile(asarPath, asar);

    const result = await handler.handleAsarSearch({
      inputPath: asarPath,
      pattern: 'isPro',
      fileGlob: '*.json',
    });
    const data = JSON.parse(result.content[0]!.text!);

    expect(data.success).toBe(true);
    // Should only match in config.json, not main.js
    if (data.matches.length > 0) {
      for (const match of data.matches) {
        expect(match.filePath).toMatch(/\.json$/);
      }
    }
  });

  it('should respect maxResults limit', async () => {
    // Create file with many matching lines
    const lines = Array.from({ length: 20 }, (_, i) => `const val${i} = true;`).join('\n');
    const asar = buildMockAsar([{ path: 'many.js', content: lines }]);
    const asarPath = join(tempDir, 'test.asar');
    await writeFile(asarPath, asar);

    const result = await handler.handleAsarSearch({
      inputPath: asarPath,
      pattern: 'val\\d+',
      maxResults: 3,
    });
    const data = JSON.parse(result.content[0]!.text!);

    expect(data.success).toBe(true);
    expect(data.totalMatches).toBeLessThanOrEqual(3);
  });

  it('should return success:false for non-existent ASAR file', async () => {
    const result = await handler.handleAsarSearch({
      inputPath: join(tempDir, 'nonexistent.asar'),
      pattern: 'test',
    });
    const data = JSON.parse(result.content[0]!.text!);
    expect(data.success).toBe(false);
  });

  it('should return success:false for an invalid regex pattern', async () => {
    const asar = buildMockAsar([{ path: 'src/index.js', content: 'console.log("hello");\n' }]);
    const asarPath = join(tempDir, 'invalid-regex.asar');
    await writeFile(asarPath, asar);

    const result = await handler.handleAsarSearch({
      inputPath: asarPath,
      pattern: '(',
    });
    const data = JSON.parse(result.content[0]!.text!);

    expect(data.success).toBe(false);
    expect(data.error).toContain('Invalid regex pattern');
  });

  it('should parse Chromium Pickle format ASAR (headerSize=4)', async () => {
    // Build ASAR using Pickle format: field0=4, field1=payloadSize, field2=jsonLen, field3=padding
    const entries = [
      { path: 'dist/main.js', content: 'const paywall = "active";' },
      { path: 'dist/utils.js', content: 'export function check() {}' },
    ];
    const dataBuffers: Buffer[] = [];
    const headerFiles: Record<string, unknown> = {};
    let offset = 0;
    for (const entry of entries) {
      const buf = Buffer.from(entry.content, 'utf-8');
      const parts = entry.path.split('/');
      let current = headerFiles;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]!]) current[parts[i]!] = { files: {} };
        current = (current[parts[i]!] as Record<string, unknown>).files as Record<string, unknown>;
      }
      current[parts[parts.length - 1]!] = {
        size: buf.length,
        offset: String(offset),
      };
      dataBuffers.push(buf);
      offset += buf.length;
    }
    const jsonStr = JSON.stringify({ files: headerFiles });
    const jsonBuf = Buffer.from(jsonStr, 'utf-8');

    // Pickle format header: [4] [jsonLen+4] [jsonLen] [0]
    const header = Buffer.alloc(16);
    header.writeUInt32LE(4, 0); // pickleHeaderSize (always 4)
    header.writeUInt32LE(jsonBuf.length + 4, 4); // payloadSize (jsonLen prefix + json)
    header.writeUInt32LE(jsonBuf.length, 8); // jsonStringLength
    header.writeUInt32LE(0, 12); // padding

    const asarBuf = Buffer.concat([header, jsonBuf, ...dataBuffers]);
    const asarPath = join(tempDir, 'pickle.asar');
    await writeFile(asarPath, asarBuf);

    const result = await handler.handleAsarSearch({
      inputPath: asarPath,
      pattern: 'paywall',
      fileGlob: '*.js',
    });
    const data = JSON.parse(result.content[0]!.text!);
    expect(data.success).toBe(true);
    expect(data.totalMatches).toBe(1);
    expect(data.matches[0].filePath).toBe('dist/main.js');
  });

  it('should handle ASAR with trailing garbage after JSON header', async () => {
    // Simulate real-world ASAR where JSON header is followed by non-null padding bytes
    const entry = { path: 'app.js', content: 'const flag = true;' };
    const contentBuf = Buffer.from(entry.content, 'utf-8');
    const jsonStr = JSON.stringify({
      files: { 'app.js': { size: contentBuf.length, offset: '0' } },
    });
    const jsonBuf = Buffer.from(jsonStr, 'utf-8');
    // Add 10 bytes of garbage after JSON
    const garbage = Buffer.from('XXXXXXXXXX', 'utf-8');
    const paddedJson = Buffer.concat([jsonBuf, garbage]);

    const header = Buffer.alloc(16);
    header.writeUInt32LE(paddedJson.length + 8, 0);
    header.writeUInt32LE(paddedJson.length + 4, 4);
    header.writeUInt32LE(paddedJson.length, 8); // includes garbage
    header.writeUInt32LE(0, 12);

    const asarBuf = Buffer.concat([header, paddedJson, contentBuf]);
    const asarPath = join(tempDir, 'garbage.asar');
    await writeFile(asarPath, asarBuf);

    const result = await handler.handleAsarSearch({
      inputPath: asarPath,
      pattern: 'flag',
      fileGlob: '*.js',
    });
    const data = JSON.parse(result.content[0]!.text!);
    expect(data.success).toBe(true);
    expect(data.totalMatches).toBe(1);
    expect(data.matches[0].filePath).toBe('app.js');
  });
});
