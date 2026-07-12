import {
  mkdtemp,
  rm,
  mkdir,
  writeFile as fsWriteFile,
  readFile as fsReadFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleAsarRepack } from '@server/domains/platform/handlers/asar-repack-handler';
import {
  parseAsarBuffer,
  readAsarEntryBuffer,
} from '@server/domains/platform/handlers/electron-asar-helpers';
import type { ToolResponse } from '@server/types';

function parseJson(res: ToolResponse): Record<string, unknown> {
  const text = res.content[0] as { text: string };
  return JSON.parse(text.text);
}

describe('handleAsarRepack', () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    tempDirs.length = 0;
  });

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  async function makeTempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'asar-repack-'));
    tempDirs.push(dir);
    return dir;
  }

  it('packs a directory tree into an ASAR that round-trips through parseAsarBuffer', async () => {
    const dir = await makeTempDir();
    const srcDir = join(dir, 'src');
    await mkdir(join(srcDir, 'lib'), { recursive: true });

    const mainJs = 'console.log("main");\nrequire("./lib/util");\n';
    const utilJs = 'module.exports = { x: 1 };\n';
    const pkg = '{"name":"app","version":"1.0.0"}';
    await fsWriteFile(join(srcDir, 'main.js'), mainJs);
    await fsWriteFile(join(srcDir, 'lib', 'util.js'), utilJs);
    await fsWriteFile(join(srcDir, 'package.json'), pkg);

    const outputPath = join(dir, 'repacked.asar');
    const result = await handleAsarRepack({ inputDir: srcDir, outputPath });
    const json = parseJson(result);

    expect(json.success).toBe(true);
    expect(json.tool).toBe('asar_repack');
    expect(json.fileCount).toBe(3);
    expect(json.outputPath).toBeTruthy();

    // Parse the produced ASAR back and verify every entry round-trips byte-for-byte.
    const asarBuffer = await fsReadFile(outputPath);
    const parsed = parseAsarBuffer(asarBuffer);
    const paths = parsed.files.map((f) => f.path).toSorted();
    expect(paths).toEqual(['lib/util.js', 'main.js', 'package.json'].toSorted());

    const mainBack = readAsarEntryBuffer(asarBuffer, parsed, 'main.js')!.toString('utf-8');
    const utilBack = readAsarEntryBuffer(asarBuffer, parsed, 'lib/util.js')!.toString('utf-8');
    const pkgBack = readAsarEntryBuffer(asarBuffer, parsed, 'package.json')!.toString('utf-8');
    expect(mainBack).toBe(mainJs);
    expect(utilBack).toBe(utilJs);
    expect(pkgBack).toBe(pkg);
  });

  it('handles nested directories and preserves file order independence', async () => {
    const dir = await makeTempDir();
    const srcDir = join(dir, 'src');
    await mkdir(join(srcDir, 'a', 'b', 'c'), { recursive: true });

    await fsWriteFile(join(srcDir, 'root.txt'), 'root');
    await fsWriteFile(join(srcDir, 'a', 'mid.txt'), 'mid');
    await fsWriteFile(join(srcDir, 'a', 'b', 'c', 'deep.txt'), 'deep');

    const outputPath = join(dir, 'nested.asar');
    const result = await handleAsarRepack({ inputDir: srcDir, outputPath });
    const json = parseJson(result);

    expect(json.success).toBe(true);
    expect(json.fileCount).toBe(3);

    const asarBuffer = await fsReadFile(outputPath);
    const parsed = parseAsarBuffer(asarBuffer);
    expect(parsed.files.map((f) => f.path).toSorted()).toEqual(
      ['a/b/c/deep.txt', 'a/mid.txt', 'root.txt'].toSorted(),
    );
    expect(readAsarEntryBuffer(asarBuffer, parsed, 'a/b/c/deep.txt')!.toString('utf-8')).toBe(
      'deep',
    );
  });

  it('produces an ASAR that asar_extract can read (cross-tool round-trip)', async () => {
    const dir = await makeTempDir();
    const srcDir = join(dir, 'src');
    await mkdir(srcDir, { recursive: true });
    await fsWriteFile(join(srcDir, 'hello.js'), 'module.exports = "hi";\n');

    const outputPath = join(dir, 'cross.asar');
    await handleAsarRepack({ inputDir: srcDir, outputPath });

    // The produced ASAR must be readable by the existing parseAsarBuffer (used by
    // asar_extract / asar_search / asar_deobfuscate) — verifying cross-tool interop.
    const asarBuffer = await fsReadFile(outputPath);
    const parsed = parseAsarBuffer(asarBuffer);
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0]!.size).toBe(23);
    expect(parsed.dataOffset).toBeGreaterThan(0);
  });

  it('packs binary files byte-for-byte (non-UTF-8 content)', async () => {
    const dir = await makeTempDir();
    const srcDir = join(dir, 'src');
    await mkdir(srcDir, { recursive: true });
    const binary = Buffer.from([0x00, 0xff, 0x1f, 0x8b, 0x7f, 0x80, 0xc0, 0xfe]);
    await fsWriteFile(join(srcDir, 'data.bin'), binary);

    const outputPath = join(dir, 'bin.asar');
    await handleAsarRepack({ inputDir: srcDir, outputPath });

    const asarBuffer = await fsReadFile(outputPath);
    const parsed = parseAsarBuffer(asarBuffer);
    const back = readAsarEntryBuffer(asarBuffer, parsed, 'data.bin');
    expect(back).toBeDefined();
    expect(Buffer.from(back!)).toEqual(binary);
  });

  it('auto-generates an output path when outputPath is omitted', async () => {
    const dir = await makeTempDir();
    const srcDir = join(dir, 'src');
    await mkdir(srcDir, { recursive: true });
    await fsWriteFile(join(srcDir, 'x.js'), 'void 0;\n');

    const result = await handleAsarRepack({ inputDir: srcDir });
    const json = parseJson(result);

    expect(json.success).toBe(true);
    expect(json.outputPath).toBeTruthy();
  });

  it('returns a failure when inputDir does not exist', async () => {
    const result = await handleAsarRepack({ inputDir: '/definitely/not/here' });
    const json = parseJson(result);
    expect(json.success).toBe(false);
    expect(json.error).toContain('does not exist');
  });

  it('returns a failure when inputDir is missing', async () => {
    const result = await handleAsarRepack({});
    const json = parseJson(result);
    expect(json.success).toBe(false);
    expect(json.error).toContain('must be a non-empty string');
  });
});
