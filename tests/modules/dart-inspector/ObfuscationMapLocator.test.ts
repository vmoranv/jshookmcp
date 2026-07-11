import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  isObfuscationSidecar,
  locateObfuscationMap,
} from '@modules/dart-inspector/ObfuscationMapLocator';

// ── Minimal ZIP builder (stored, no compression) for APK fixtures ──
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === undefined) continue;
    c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeZip(entries: Array<{ name: string; content: string }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.content, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8); // method 0 = stored
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);
    locals.push(local, data);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centrals.push(central);

    offset += local.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

describe('ObfuscationMapLocator', () => {
  it('isObfuscationSidecar matches known sidecar names and rejects others', () => {
    expect(isObfuscationSidecar('obfuscation.txt')).toBe(true);
    expect(isObfuscationSidecar('obfuscation.map')).toBe(true);
    expect(isObfuscationSidecar('obfuscation.json')).toBe(true);
    expect(isObfuscationSidecar('assets/flutter_assets/obfuscation.json')).toBe(true);
    expect(isObfuscationSidecar('libapp.so')).toBe(false);
    expect(isObfuscationSidecar('README.md')).toBe(false);
    expect(isObfuscationSidecar('obfuscation.bin')).toBe(false); // unknown ext
  });

  it('returns null when no input is provided', async () => {
    expect(await locateObfuscationMap({})).toBeNull();
  });

  it('locates a sidecar inside a directory tree', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'obf-'));
    try {
      await mkdir(join(dir, 'assets', 'flutter_assets'), { recursive: true });
      await writeFile(join(dir, 'assets', 'flutter_assets', 'obfuscation.json'), '{"a":"b"}');
      const r = await locateObfuscationMap({ searchDir: dir });
      expect(r).not.toBeNull();
      expect(r!.path.endsWith('obfuscation.json')).toBe(true);
      expect(r!.source).toBe(`directory:${dir}`);
      expect(r!.candidates).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns null when the directory has no sidecar', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'obf-'));
    try {
      await writeFile(join(dir, 'libapp.so'), 'not a sidecar');
      expect(await locateObfuscationMap({ searchDir: dir })).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('locates and extracts a sidecar from an APK zip', async () => {
    const zipDir = await mkdtemp(join(tmpdir(), 'apk-'));
    const apkPath = join(zipDir, 'test.apk');
    await writeFile(
      apkPath,
      makeZip([
        { name: 'lib/arm64-v8a/libapp.so', content: 'binary' },
        { name: 'assets/flutter_assets/obfuscation.json', content: '{"foo":"bar"}' },
      ]),
    );
    try {
      const r = await locateObfuscationMap({ apkPath });
      expect(r).not.toBeNull();
      expect(r!.source).toBe('apk:assets/flutter_assets/obfuscation.json');
      const extracted = await readFile(r!.path, 'utf8');
      expect(extracted).toBe('{"foo":"bar"}');
    } finally {
      await rm(zipDir, { recursive: true, force: true });
    }
  });

  it('returns null when the APK has no sidecar', async () => {
    const zipDir = await mkdtemp(join(tmpdir(), 'apk-'));
    const apkPath = join(zipDir, 'test.apk');
    await writeFile(apkPath, makeZip([{ name: 'lib/arm64-v8a/libapp.so', content: 'binary' }]));
    try {
      expect(await locateObfuscationMap({ apkPath })).toBeNull();
    } finally {
      await rm(zipDir, { recursive: true, force: true });
    }
  });
});
