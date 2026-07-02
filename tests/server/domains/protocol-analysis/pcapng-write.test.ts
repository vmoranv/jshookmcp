import { rm, readFile as fsReadFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProtocolAnalysisHandlers } from '@server/domains/protocol-analysis/handlers';
import { parsePcapng } from '@server/domains/protocol-analysis/handlers/shared/network-packet/pcapng-reader';

describe('ProtocolAnalysisHandlers — handlePcapngWrite', () => {
  let handlers: ProtocolAnalysisHandlers;
  const eventBus = { emit: vi.fn() } as any;
  const paths: string[] = [];

  beforeEach(() => {
    eventBus.emit.mockClear();
    handlers = new ProtocolAnalysisHandlers(undefined, undefined, eventBus);
  });

  afterEach(async () => {
    while (paths.length > 0) {
      const path = paths.pop();
      if (path) {
        await rm(path, { force: true });
      }
    }
  });

  it('writes a PCAPNG file that round-trips through handlePcapngRead', async () => {
    const path = join(tmpdir(), `pcapng-write-${Date.now()}.pcapng`);
    paths.push(path);

    const writeResult = await handlers.handlePcapngWrite({
      path,
      interfaces: [{ linkType: 1, snapLen: 65535, name: 'eth0' }],
      packets: [
        {
          dataHex: '001122334455aabbccddeeff08004500',
          timestampHigh: 0,
          timestampLow: 1000,
          originalLength: 16,
        },
        {
          dataHex: 'aabb',
          interfaceId: 0,
        },
      ],
      endianness: 'little',
    });

    expect(writeResult.success).toBe(true);
    expect(writeResult.packetCount).toBe(2);
    expect(writeResult.interfaceCount).toBe(1);
    expect(writeResult.endianness).toBe('little');
    expect(writeResult.byteLength).toBeGreaterThan(0);
    expect(eventBus.emit).toHaveBeenCalledWith(
      'protocol:pcapng_written',
      expect.objectContaining({ path, packetCount: 2, interfaceCount: 1 }),
    );

    const readResult = await handlers.handlePcapngRead({ path });

    expect(readResult.success).toBe(true);
    expect(readResult.interfaces[0]?.linkType).toBe(1);
    expect(readResult.interfaces[0]?.name).toBe('eth0');
    expect(readResult.packets).toHaveLength(2);
    expect(readResult.packets[0]?.dataHex).toBe('001122334455aabbccddeeff08004500');
    expect(readResult.packets[0]?.originalLength).toBe(16);
    expect(readResult.packets[0]?.timestampLow).toBe(1000);
    expect(readResult.packets[1]?.dataHex).toBe('aabb');
  });

  it('produces a byte-exact deterministic buffer for the same input', async () => {
    const path1 = join(tmpdir(), `pcapng-det-1-${Date.now()}.pcapng`);
    const path2 = join(tmpdir(), `pcapng-det-2-${Date.now()}.pcapng`);
    paths.push(path1, path2);

    const args = {
      interfaces: [{ linkType: 101 }],
      packets: [{ dataHex: 'deadbeef', timestampHigh: 1, timestampLow: 2 }],
    };

    await handlers.handlePcapngWrite({ path: path1, ...args });
    await handlers.handlePcapngWrite({ path: path2, ...args });

    const buf1 = await fsReadFile(path1);
    const buf2 = await fsReadFile(path2);
    expect(buf1.equals(buf2)).toBe(true);
  });

  it('emits a Section Header Block followed by an Interface Description Block', async () => {
    const path = join(tmpdir(), `pcapng-layout-${Date.now()}.pcapng`);
    paths.push(path);

    await handlers.handlePcapngWrite({
      path,
      interfaces: [{ linkType: 1 }],
      packets: [{ dataHex: 'aa' }],
    });

    const buffer = await fsReadFile(path);
    const result = parsePcapng(buffer);

    expect(result.blockCount).toBe(3);
    expect(result.sections).toHaveLength(1);
    expect(result.interfaces).toHaveLength(1);
    expect(result.packets).toHaveLength(1);
  });

  it('returns a structured error when interfaces is empty', async () => {
    const path = join(tmpdir(), `pcapng-empty-${Date.now()}.pcapng`);
    paths.push(path);

    const result = await handlers.handlePcapngWrite({
      path,
      interfaces: [],
      packets: [],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('at least one interface');
  });

  it('returns a structured error for an invalid linkType', async () => {
    const path = join(tmpdir(), `pcapng-badlink-${Date.now()}.pcapng`);
    paths.push(path);

    const result = await handlers.handlePcapngWrite({
      path,
      interfaces: [{ linkType: -1 }],
      packets: [],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('linkType');
  });

  it('returns a structured error for an invalid hex payload', async () => {
    const path = join(tmpdir(), `pcapng-badhex-${Date.now()}.pcapng`);
    paths.push(path);

    const result = await handlers.handlePcapngWrite({
      path,
      interfaces: [{ linkType: 1 }],
      packets: [{ dataHex: 'xyz' }],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('hex');
  });

  it('returns a structured error when path is missing', async () => {
    const result = await handlers.handlePcapngWrite({
      interfaces: [{ linkType: 1 }],
      packets: [],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('path');
  });
});
