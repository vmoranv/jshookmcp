/**
 * apk — extractArm64Libs end-to-end test.
 *
 * The project ships no zip-writing dependency (apk-packer's tests avoid real
 * archives by walking directories). To exercise the actual yauzl extraction
 * path we hand-build a STORED (no-compression) zip — the format is fully under
 * our control — and confirm extractArm64Libs pulls lib/arm64-v8a/*.so bytes
 * back out while skipping other ABIs and non-lib entries. The zip layout here
 * was verified against yauzl before being pinned.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';

import { extractArm64Libs } from '@modules/native-emulator/apk';

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'nemu-apk-test-'));
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const u16 = (v: number): number[] => [v & 0xff, (v >>> 8) & 0xff];
const u32 = (v: number): number[] => [
  v & 0xff,
  (v >>> 8) & 0xff,
  (v >>> 16) & 0xff,
  (v >>> 24) & 0xff,
];

/** Build a STORED (method 0) zip from name→bytes entries. */
function buildStoredZip(entries: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const crc = crc32(Buffer.from(e.data)) >>> 0;
    const size = e.data.length;
    const lfh = Uint8Array.from([
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(crc),
      ...u32(size),
      ...u32(size),
      ...u16(nameBytes.length),
      ...u16(0),
      ...nameBytes,
    ]);
    chunks.push(lfh, e.data);
    central.push(
      Uint8Array.from([
        ...u32(0x02014b50),
        ...u16(20),
        ...u16(20),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u32(crc),
        ...u32(size),
        ...u32(size),
        ...u16(nameBytes.length),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u32(0),
        ...u32(offset),
        ...nameBytes,
      ]),
    );
    offset += lfh.length + e.data.length;
  }

  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) cdSize += c.length;
  const eocd = Uint8Array.from([
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(central.length),
    ...u16(central.length),
    ...u32(cdSize),
    ...u32(cdStart),
    ...u16(0),
  ]);

  const all = [...chunks, ...central, eocd];
  let len = 0;
  for (const c of all) len += c.length;
  const out = new Uint8Array(len);
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

async function writeApk(
  name: string,
  entries: { name: string; data: Uint8Array }[],
): Promise<string> {
  const apkPath = join(workDir, name);
  await writeFile(apkPath, buildStoredZip(entries));
  return apkPath;
}

const ELF_BYTES = Uint8Array.from([0x7f, 0x45, 0x4c, 0x46, 1, 2, 3, 4, 5, 6]);

describe('extractArm64Libs', () => {
  it('extracts a lib/arm64-v8a/*.so as raw bytes', async () => {
    const apk = await writeApk('sample.apk', [
      { name: 'AndroidManifest.xml', data: Uint8Array.from([1, 2, 3]) },
      { name: 'lib/arm64-v8a/libtest.so', data: ELF_BYTES },
    ]);
    const libs = await extractArm64Libs(apk);
    expect(libs).toHaveLength(1);
    expect(libs[0]!.name).toBe('libtest.so');
    expect(Array.from(libs[0]!.bytes)).toEqual(Array.from(ELF_BYTES));
  });

  it('skips other ABIs (armeabi-v7a, x86_64) — only arm64-v8a is loadable', async () => {
    const apk = await writeApk('multi-abi.apk', [
      { name: 'lib/arm64-v8a/libapp.so', data: ELF_BYTES },
      { name: 'lib/armeabi-v7a/libapp.so', data: Uint8Array.from([9, 9]) },
      { name: 'lib/x86_64/libapp.so', data: Uint8Array.from([8, 8]) },
    ]);
    const libs = await extractArm64Libs(apk);
    expect(libs).toHaveLength(1);
    expect(libs[0]!.name).toBe('libapp.so');
  });

  it('returns multiple arm64 libs in archive order', async () => {
    const apk = await writeApk('flutter.apk', [
      { name: 'lib/arm64-v8a/libflutter.so', data: Uint8Array.from([1]) },
      { name: 'lib/arm64-v8a/libapp.so', data: Uint8Array.from([2]) },
    ]);
    const libs = await extractArm64Libs(apk);
    expect(libs.map((l) => l.name)).toEqual(['libflutter.so', 'libapp.so']);
  });

  it('returns empty for an APK with no arm64 native libs', async () => {
    const apk = await writeApk('no-native.apk', [
      { name: 'classes.dex', data: Uint8Array.from([0xde, 0xad]) },
    ]);
    expect(await extractArm64Libs(apk)).toHaveLength(0);
  });

  it('throws VALIDATION for an empty apkPath', async () => {
    await expect(extractArm64Libs('')).rejects.toThrowError(
      expect.objectContaining({ name: 'ToolError', code: 'VALIDATION' }),
    );
  });

  it('throws VALIDATION when the file is not a valid zip', async () => {
    const notZip = join(workDir, 'fake.apk');
    await writeFile(notZip, 'plain text, not a zip archive');
    await expect(extractArm64Libs(notZip)).rejects.toThrowError(
      expect.objectContaining({ name: 'ToolError', code: 'VALIDATION' }),
    );
  });
});
