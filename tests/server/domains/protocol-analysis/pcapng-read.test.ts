import { mkdtemp, rm, writeFile as fsWriteFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProtocolAnalysisHandlers } from '@server/domains/protocol-analysis/handlers';
import {
  PCAPNG_BLOCK_TYPE,
  PCAPNG_BYTE_ORDER_MAGIC,
  type PcapngWriteInput,
} from '@server/domains/protocol-analysis/handlers/shared/network-packet/pcapng';
import { parsePcapng } from '@server/domains/protocol-analysis/handlers/shared/network-packet/pcapng-reader';
import { buildPcapng } from '@server/domains/protocol-analysis/handlers/shared/network-packet/pcapng-writer';

describe('ProtocolAnalysisHandlers — handlePcapngRead', () => {
  let handlers: ProtocolAnalysisHandlers;
  const eventBus = { emit: vi.fn() } as any;
  const tempDirs: string[] = [];

  beforeEach(() => {
    eventBus.emit.mockClear();
    handlers = new ProtocolAnalysisHandlers(undefined, undefined, eventBus);
  });

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it('parses a minimal little-endian PCAPNG file built by buildPcapng', async () => {
    const input: PcapngWriteInput = {
      endianness: 'little',
      interfaces: [{ linkType: 1, snapLen: 65535 }],
      packets: [{ dataHex: 'aabbccdd', timestampHigh: 0, timestampLow: 100 }],
    };
    const buffer = buildPcapng(input);
    const dir = await mkdtemp(join(tmpdir(), 'pcapng-read-'));
    tempDirs.push(dir);
    const path = join(dir, 'minimal.pcapng');
    await fsWriteFile(path, buffer);

    const result = await handlers.handlePcapngRead({ path });

    expect(result.success).toBe(true);
    expect(result.endianness).toBe('little');
    expect(result.blockCount).toBe(3); // SHB + IDB + EPB
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]?.majorVersion).toBe(1);
    expect(result.sections[0]?.minorVersion).toBe(0);
    expect(result.sections[0]?.byteOrderMagic).toBe(PCAPNG_BYTE_ORDER_MAGIC);
    expect(result.sections[0]?.sectionLengthUnspecified).toBe(true);
    expect(result.interfaces).toHaveLength(1);
    expect(result.interfaces[0]?.linkType).toBe(1);
    expect(result.interfaces[0]?.snapLen).toBe(65535);
    expect(result.packets).toHaveLength(1);
    expect(result.packets[0]).toMatchObject({
      kind: 'enhanced',
      interfaceId: 0,
      timestampHigh: 0,
      timestampLow: 100,
      capturedLength: 4,
      originalLength: 4,
      dataHex: 'aabbccdd',
      truncated: false,
    });
    expect(eventBus.emit).toHaveBeenCalledWith(
      'protocol:pcapng_read',
      expect.objectContaining({ path, blockCount: 3, packetCount: 1 }),
    );
  });

  it('parses a big-endian PCAPNG file and reports big endianness', async () => {
    const input: PcapngWriteInput = {
      endianness: 'big',
      interfaces: [{ linkType: 101 }], // raw IP
      packets: [{ dataHex: '45000014' }],
    };
    const buffer = buildPcapng(input);
    const dir = await mkdtemp(join(tmpdir(), 'pcapng-be-'));
    tempDirs.push(dir);
    const path = join(dir, 'be.pcapng');
    await fsWriteFile(path, buffer);

    const result = await handlers.handlePcapngRead({ path });

    expect(result.success).toBe(true);
    expect(result.endianness).toBe('big');
    expect(result.interfaces[0]?.linkType).toBe(101);
    expect(result.packets[0]?.dataHex).toBe('45000014');
  });

  it('respects maxBytesPerPacket to truncate reported packet data', async () => {
    const input: PcapngWriteInput = {
      interfaces: [{ linkType: 1 }],
      packets: [{ dataHex: 'aabbccddeeff0011' }],
    };
    const buffer = buildPcapng(input);
    const dir = await mkdtemp(join(tmpdir(), 'pcapng-trunc-'));
    tempDirs.push(dir);
    const path = join(dir, 'trunc.pcapng');
    await fsWriteFile(path, buffer);

    const result = await handlers.handlePcapngRead({ path, maxBytesPerPacket: 4 });

    expect(result.packets[0]?.dataHex).toBe('aabbccdd');
    expect(result.packets[0]?.truncated).toBe(true);
    expect(result.packets[0]?.capturedLength).toBe(8);
  });

  it('filters packets by interfaceId when interfaceFilter is set', async () => {
    const input: PcapngWriteInput = {
      interfaces: [{ linkType: 1 }, { linkType: 101 }],
      packets: [
        { dataHex: 'aa', interfaceId: 0 },
        { dataHex: 'bb', interfaceId: 1 },
        { dataHex: 'cc', interfaceId: 0 },
      ],
    };
    const buffer = buildPcapng(input);
    const dir = await mkdtemp(join(tmpdir(), 'pcapng-filter-'));
    tempDirs.push(dir);
    const path = join(dir, 'filter.pcapng');
    await fsWriteFile(path, buffer);

    const result = await handlers.handlePcapngRead({ path, interfaceFilter: 1 });

    expect(result.packets).toHaveLength(1);
    expect(result.packets[0]?.interfaceId).toBe(1);
    expect(result.packets[0]?.dataHex).toBe('bb');
  });

  it('surfaces unknown block types as warnings rather than failing', async () => {
    // Build a synthetic SHB + one unknown block (type 0x00000BAD).
    const shb = Buffer.alloc(28);
    shb.writeUInt32LE(PCAPNG_BLOCK_TYPE.SECTION_HEADER, 0);
    shb.writeUInt32LE(28, 4);
    shb.writeUInt32LE(PCAPNG_BYTE_ORDER_MAGIC, 8);
    shb.writeUInt16LE(1, 12);
    shb.writeUInt16LE(0, 14);
    shb.writeUInt32LE(0xffffffff, 16);
    shb.writeUInt32LE(0xffffffff, 20);
    shb.writeUInt32LE(28, 24);

    const unknownBody = Buffer.from('deadbeef', 'hex');
    const unknown = Buffer.alloc(16);
    unknown.writeUInt32LE(0x00000bad, 0);
    unknown.writeUInt32LE(16, 4);
    unknownBody.copy(unknown, 8);
    unknown.writeUInt32LE(16, 12);

    const dir = await mkdtemp(join(tmpdir(), 'pcapng-unknown-'));
    tempDirs.push(dir);
    const path = join(dir, 'unknown.pcapng');
    await fsWriteFile(path, Buffer.concat([shb, unknown]));

    const result = await handlers.handlePcapngRead({ path });

    expect(result.success).toBe(true);
    expect(result.unknownBlocks).toHaveLength(1);
    expect(result.unknownBlocks[0]?.type).toBe(0x00000bad);
    expect(result.unknownBlocks[0]?.bodyHex).toBe('deadbeef');
    expect(result.interfaces).toHaveLength(0);
  });

  it('returns a structured error for a non-PCAPNG file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pcapng-bad-'));
    tempDirs.push(dir);
    const path = join(dir, 'not-pcapng.pcapng');
    await fsWriteFile(path, Buffer.from('not a pcapng file'.repeat(2)));

    const result = await handlers.handlePcapngRead({ path });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Not a PCAPNG file');
    expect(result.packets).toEqual([]);
  });

  it('returns a structured error when path is missing', async () => {
    const result = await handlers.handlePcapngRead({});

    expect(result.success).toBe(false);
    expect(result.error).toContain('path');
  });
});

describe('parsePcapng (unit-level edge cases)', () => {
  it('rejects a buffer too short to be a PCAPNG file', () => {
    expect(() => parsePcapng(Buffer.alloc(4))).toThrow(/Not a PCAPNG file/);
  });

  it('throws on a Section Header Block with a mismatched byte-order magic', () => {
    const buffer = Buffer.alloc(28);
    buffer.writeUInt32LE(PCAPNG_BLOCK_TYPE.SECTION_HEADER, 0);
    buffer.writeUInt32LE(28, 4);
    buffer.writeUInt32LE(0xdeadbeef, 8); // wrong BOM
    buffer.writeUInt16LE(1, 12);
    buffer.writeUInt16LE(0, 14);
    buffer.writeUInt32LE(0xffffffff, 16);
    buffer.writeUInt32LE(0xffffffff, 20);
    buffer.writeUInt32LE(28, 24);
    expect(() => parsePcapng(buffer)).toThrow(/Not a PCAPNG file/);
  });
});
