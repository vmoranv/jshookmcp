import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalPlatform = process.platform;

const { state, mockKoffi } = vi.hoisted(() => {
  const shared = {
    replySizes: [] as number[],
  };

  const inetAddr = vi.fn(() => 0x01010101);
  const createFile = vi.fn(() => 1n);
  const closeHandle = vi.fn(() => true);
  const sendEcho = vi.fn(
    (
      _handle: bigint,
      destAddr: number,
      _sendData: Buffer,
      _sendLength: number,
      _options: Buffer,
      replyBuf: Buffer,
      replySize: number,
    ) => {
      shared.replySizes.push(replySize);
      replyBuf.writeUInt32LE(destAddr >>> 0, 0);
      replyBuf.writeUInt32LE(0, 4);
      replyBuf.writeUInt32LE(7, 8);
      return 1;
    },
  );

  return {
    state: shared,
    mockKoffi: {
      load: vi.fn(() => ({
        func: vi.fn((signature: string) => {
          if (signature.includes('inet_addr')) return inetAddr;
          if (signature.includes('IcmpCreateFile')) return createFile;
          if (signature.includes('IcmpCloseHandle')) return closeHandle;
          if (signature.includes('IcmpSendEcho')) return sendEcho;
          return vi.fn();
        }),
        unload: vi.fn(),
      })),
    },
  };
});

vi.mock('koffi', () => ({ default: mockKoffi }));
vi.mock('@utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('IcmpProbe Windows reply buffer sizing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.replySizes.length = 0;
    Object.defineProperty(process, 'platform', { value: 'win32' });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('sizes the Windows ICMP reply buffer to fit larger echo payloads', async () => {
    vi.resetModules();
    const { icmpProbe, unloadIcmpLibraries } = await import('@src/native/IcmpProbe');

    const result = icmpProbe({ target: '1.1.1.1', packetSize: 2048, timeout: 1000 });

    expect(result.alive).toBe(true);
    expect(state.replySizes).toHaveLength(1);
    expect(state.replySizes[0]).toBeGreaterThan(2048);
    expect(state.replySizes[0]).not.toBe(256);

    unloadIcmpLibraries();
  });

  it('uses the same dynamic buffer sizing when traceroute probes large payloads', async () => {
    vi.resetModules();
    const { traceroute, unloadIcmpLibraries } = await import('@src/native/IcmpProbe');

    const result = traceroute({ target: '1.1.1.1', maxHops: 1, packetSize: 4096, timeout: 1000 });

    expect(result.totalHops).toBe(1);
    expect(state.replySizes).toHaveLength(1);
    expect(state.replySizes[0]).toBeGreaterThan(4096);

    unloadIcmpLibraries();
  });
});
