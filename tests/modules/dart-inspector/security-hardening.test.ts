/**
 * Regression tests for hardened dart-inspector bounds, prototype-key, and
 * malformed-ELF handling.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DART_PP_MAX_SLOTS, DART_PP_PREVIEW_BYTES } from '@src/constants';
import { DART_SNAPSHOT_MAGIC } from '@modules/dart-inspector/snapshot-types';
import { categorize, classifyOneRule, compileRuleInput } from '@modules/dart-inspector/classifiers';
import type { CategoryRule, ExtractedString } from '@modules/dart-inspector/types';
import { ObjectPoolDumper } from '@modules/dart-inspector/ObjectPoolDumper';
import { SmiScanner } from '@modules/dart-inspector/SmiScanner';
import { SnapshotFingerprint } from '@modules/dart-inspector/SnapshotFingerprint';

let tmpDir: string;
let probeFile: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'dart-hardening-'));
  probeFile = join(tmpDir, 'probe.bin');
  await writeFile(probeFile, Buffer.alloc(256));
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function mkString(value: string): ExtractedString {
  return { value, offsets: [0], encoding: 'ascii' };
}

describe('classifiers — reserved categories and prototype safety', () => {
  it.each(['__proto__', 'constructor', 'prototype', 'raw'])(
    'rejects reserved custom rule category %s',
    (category) => {
      expect(() => compileRuleInput({ category, pattern: '^x$' })).toThrowError(
        expect.objectContaining({ name: 'ToolError', code: 'VALIDATION' }),
      );
    },
  );

  it('builds a null-prototype result and never mutates the prototype chain', () => {
    const rules: CategoryRule[] = [{ category: '__proto__', pattern: /^x$/ }];
    const out = categorize([mkString('x')], rules, false);
    expect(Object.getPrototypeOf(out)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(out, '__proto__')).toBe(true);
    expect((out as Record<string, unknown>)['__proto__']).toEqual([mkString('x')]);
    expect(out.urls).toBeUndefined();
  });

  it('skips a filename-gated rule when the filename is unknown', () => {
    const rule = compileRuleInput({
      category: 'gated',
      pattern: '^HIT$',
      enableWhenFileNameMatches: '^libapp\\.so$',
    });
    expect(classifyOneRule('HIT', [rule], 50, undefined)).toBeUndefined();
    expect(classifyOneRule('HIT', [rule], 50, 'other.so')).toBeUndefined();
    expect(classifyOneRule('HIT', [rule], 50, 'libapp.so')?.category).toBe('gated');
  });

  it('applies the runtime timeout guard to the filename predicate', () => {
    // Bypasses compileRuleInput on purpose: this is the runtime red line.
    const rule: CategoryRule = {
      category: 'gated',
      pattern: /^never$/,
      // codeql[js/redos]
      enableWhen: { fileNameMatches: /^(a|aa)+$/ },
    };
    const hostileName = `${'a'.repeat(24)}b`;
    expect(() => classifyOneRule('HIT', [rule], 0, hostileName)).toThrowError(
      expect.objectContaining({ name: 'ToolError', code: 'TIMEOUT' }),
    );
  });
});

describe('ObjectPoolDumper — caller-controlled allocation bounds', () => {
  it('rejects maxSlots above DART_PP_MAX_SLOTS', async () => {
    await expect(
      new ObjectPoolDumper().dump(probeFile, { maxSlots: DART_PP_MAX_SLOTS + 1 }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects non-integer maxSlots', async () => {
    await expect(new ObjectPoolDumper().dump(probeFile, { maxSlots: 1.5 })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('rejects previewBytes above DART_PP_PREVIEW_BYTES', async () => {
    await expect(
      new ObjectPoolDumper().dump(probeFile, { previewBytes: DART_PP_PREVIEW_BYTES + 1 }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects non-integer previewBytes', async () => {
    await expect(
      new ObjectPoolDumper().dump(probeFile, { previewBytes: 2.5 }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

describe('SmiScanner — option validation', () => {
  it('rejects non-positive / non-integer maxResults', async () => {
    const scanner = new SmiScanner();
    for (const maxResults of [0, -1, Number.NaN, 1.5]) {
      await expect(scanner.scanFile(probeFile, { maxResults })).rejects.toMatchObject({
        code: 'VALIDATION',
      });
    }
  });

  it('rejects non-positive / non-integer maxChunkBytes', async () => {
    const scanner = new SmiScanner();
    for (const maxChunkBytes of [0, -1, Number.NaN, 1.5]) {
      await expect(scanner.scanFile(probeFile, { maxChunkBytes })).rejects.toMatchObject({
        code: 'VALIDATION',
      });
    }
  });
});

describe('SnapshotFingerprint — prototype keys and malformed ELF geometry', () => {
  function buildSnapshotBlob(features: string): Buffer {
    const buf = Buffer.alloc(0x28 + Buffer.byteLength(features, 'utf8') + 1);
    buf.writeUInt32LE(DART_SNAPSHOT_MAGIC, 0);
    buf.writeUInt32LE(2, 4); // kind = full-aot
    buf.write(features, 0x28, 'utf8');
    return buf;
  }

  function buildElf64Header(
    fileSize: number,
    opts: { shoff: number; shentsize: number; shnum: number },
  ): Buffer {
    const buf = Buffer.alloc(fileSize);
    buf.write('\x7fELF', 0, 'binary');
    buf.writeUInt8(2, 4); // ELF64
    buf.writeUInt8(1, 5); // little-endian
    buf.writeBigUInt64LE(BigInt(opts.shoff), 0x28);
    buf.writeUInt16LE(opts.shentsize, 0x3a);
    buf.writeUInt16LE(opts.shnum, 0x3c);
    return buf;
  }

  function writeShdr64(
    table: Buffer,
    index: number,
    entSize: number,
    fields: { type: number; offset: number; size: number; link: number; entsize: number },
  ): void {
    const base = index * entSize;
    table.writeUInt32LE(0, base + 0x00); // sh_name
    table.writeUInt32LE(fields.type, base + 0x04);
    table.writeBigUInt64LE(0n, base + 0x10); // sh_addr
    table.writeBigUInt64LE(BigInt(fields.offset), base + 0x18);
    table.writeBigUInt64LE(BigInt(fields.size), base + 0x20);
    table.writeUInt32LE(fields.link, base + 0x28);
    table.writeUInt32LE(0, base + 0x2c); // sh_info
    table.writeBigUInt64LE(0n, base + 0x30); // sh_addralign
    table.writeBigUInt64LE(BigInt(fields.entsize), base + 0x38);
  }

  it('ignores feature tokens that name Object.prototype members', async () => {
    const path = join(tmpDir, 'proto-features.bin');
    await writeFile(path, buildSnapshotBlob('product constructor'));
    const header = await new SnapshotFingerprint().parseHeader(path);
    expect(header.targetArch).toBe('unknown');
  });

  it('does not throw on an undersized e_shentsize', async () => {
    const path = join(tmpDir, 'undersized-shentsize.so');
    await writeFile(path, buildElf64Header(96, { shoff: 64, shentsize: 32, shnum: 1 }));
    const header = await new SnapshotFingerprint().parseHeader(path);
    expect(header.kind).toBe('unknown');
    expect(header.fileOffset).toBe(-1);
  });

  it('does not read past a dynsym with an undersized sh_entsize', async () => {
    const symName = '_kDartIsolateSnapshotData';
    const dynstr = Buffer.concat([Buffer.from('\0', 'latin1'), Buffer.from(symName, 'latin1')]);
    const dynsymOffset = 256;
    const dynstrOffset = 272;
    const fileSize = dynstrOffset + dynstr.length;
    const buf = buildElf64Header(fileSize, { shoff: 64, shentsize: 64, shnum: 3 });

    const sht = buf.subarray(64, 64 + 64 * 3);
    writeShdr64(sht, 1, 64, {
      type: 11,
      offset: dynsymOffset,
      size: 16,
      link: 2,
      entsize: 8, // undersized (ELF64 symbol is 24 bytes)
    });
    writeShdr64(sht, 2, 64, {
      type: 3,
      offset: dynstrOffset,
      size: dynstr.length,
      link: 0,
      entsize: 0,
    });

    // Under the old tiny stride this st_name would resolve to the snapshot
    // symbol and then read st_value past the 16-byte dynsym buffer.
    buf.writeUInt32LE(1, dynsymOffset + 8);
    dynstr.copy(buf, dynstrOffset);

    const path = join(tmpDir, 'undersized-dynsym-ent.so');
    await writeFile(path, buf);
    const header = await new SnapshotFingerprint().parseHeader(path);
    expect(header.kind).toBe('unknown');
    expect(header.fileOffset).toBe(-1);
  });
});
