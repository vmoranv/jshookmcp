import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalPlatform = process.platform;
const originalArch = process.arch;

const { state, mockKoffi, posixMocks } = vi.hoisted(() => {
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
      // ICMP_ECHO_REPLY: Address is IPAddr (ULONG, 4 bytes) on both x86 and
      // x64. Status @4, RoundTripTime @8; only Data/Options pointer width
      // changes. Writing 64-bit offsets would make Status read the RTT.
      replyBuf.writeUInt32LE(destAddr >>> 0, 0);
      replyBuf.writeUInt32LE(0, 4);
      replyBuf.writeUInt32LE(7, 8);
      return 1;
    },
  );
  Object.assign(sendEcho, {
    async: (
      handle: bigint,
      destAddr: number,
      sendData: Buffer,
      sendLength: number,
      options: Buffer,
      replyBuf: Buffer,
      replySize: number,
      _timeoutMs: number,
      callback: (err: unknown, result: number) => void,
    ) => {
      try {
        const result = sendEcho(
          handle,
          destAddr,
          sendData,
          sendLength,
          options,
          replyBuf,
          replySize,
        );
        queueMicrotask(() => callback(null, result));
      } catch (error) {
        queueMicrotask(() => callback(error, 0));
      }
    },
  });

  const posixSocket = vi.fn(() => 10);
  const posixClose = vi.fn(() => 0);
  const posixSendto = vi.fn(() => 32);
  const posixRecv = vi.fn(() => 0);
  const posixSetSockOpt = vi.fn(
    (_fd: number, _level: number, _optname: number, _optval: Buffer, _optlen: number) => 0,
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
          if (signature.includes('socket')) return posixSocket;
          if (signature.includes('close')) return posixClose;
          if (signature.includes('sendto')) return posixSendto;
          if (signature.includes('recv')) return posixRecv;
          if (signature.includes('setsockopt')) return posixSetSockOpt;
          return vi.fn();
        }),
        unload: vi.fn(),
      })),
    },
    posixMocks: { posixSocket, posixClose, posixSendto, posixRecv, posixSetSockOpt },
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

    const result = await icmpProbe({ target: '1.1.1.1', packetSize: 2048, timeout: 1000 });

    expect(result.alive).toBe(true);
    expect(state.replySizes).toHaveLength(1);
    expect(state.replySizes[0]).toBeGreaterThan(2048);
    expect(state.replySizes[0]).not.toBe(256);

    unloadIcmpLibraries();
  });

  it('uses the same dynamic buffer sizing when traceroute probes large payloads', async () => {
    vi.resetModules();
    const { traceroute, unloadIcmpLibraries } = await import('@src/native/IcmpProbe');

    const result = await traceroute({
      target: '1.1.1.1',
      maxHops: 1,
      packetSize: 4096,
      timeout: 1000,
    });

    expect(result.totalHops).toBe(1);
    expect(state.replySizes).toHaveLength(1);
    expect(state.replySizes[0]).toBeGreaterThan(4096);

    unloadIcmpLibraries();
  });
});

describe('IcmpProbe POSIX traceroute SEND_ERROR', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.replySizes.length = 0;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('handles SEND_ERROR in posixTraceroute and stops after consecutive failures', async () => {
    posixMocks.posixSendto.mockReturnValue(-1);
    vi.resetModules();
    const { traceroute, unloadIcmpLibraries } = await import('@src/native/IcmpProbe');

    const result = await traceroute({ target: '1.1.1.1', maxHops: 30, timeout: 1000 });

    expect(result.hops.length).toBeLessThanOrEqual(5);
    expect(result.hops.every((h: { status: string }) => h.status === 'SEND_ERROR')).toBe(true);
    expect(result.reached).toBe(false);

    unloadIcmpLibraries();
  });
});

describe('IcmpProbe Windows ICMP_ECHO_REPLY32 (x86 layout)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(process, 'platform', { value: 'win32' });
    // Node's real 32-bit arch value is 'ia32' (Windows/other platforms use
    // 'x64' / 'arm64' / 'ia32' — never 'x86'). Using the real value keeps the
    // width gate (`process.arch !== 'ia32'`) exercising the 32-bit layout.
    Object.defineProperty(process, 'arch', { value: 'ia32' });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    Object.defineProperty(process, 'arch', { value: originalArch });
  });

  it('parses the 32-bit reply layout (Address@0 Status@4 RTT@8)', async () => {
    vi.resetModules();
    const { icmpProbe, unloadIcmpLibraries } = await import('@src/native/IcmpProbe');

    const result = await icmpProbe({ target: '1.1.1.1', timeout: 1000 });

    expect(result.alive).toBe(true);
    expect(result.rtt).toBe(7);
    expect(result.ip).toBe('1.1.1.1');

    unloadIcmpLibraries();
  });
});

describe('IcmpProbe POSIX reply source-IP validation', () => {
  let capturedId = 0;
  let replySourceIp = '1.2.3.4';

  /** Build an IPv4 header (20B) + ICMP echo reply whose id/source are controllable. */
  function buildReply(): Buffer {
    const buf = Buffer.alloc(28, 0);
    buf[0] = 0x45; // IPv4, IHL=5
    const parts = replySourceIp.split('.').map(Number);
    buf[12] = parts[0]!;
    buf[13] = parts[1]!;
    buf[14] = parts[2]!;
    buf[15] = parts[3]!;
    buf[20] = 0; // ICMP type: Echo Reply
    buf[21] = 0; // code
    buf.writeUInt16BE(capturedId, 24); // id at ihl+4
    buf.writeUInt16BE(1, 26); // seq
    return buf;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    capturedId = 0;
    replySourceIp = '1.2.3.4';
    Object.defineProperty(process, 'platform', { value: 'linux' });

    // Capture the random per-probe id from the outbound echo packet
    // (ICMP header: type@0 code@1 checksum@2 id@4 seq@6).
    (posixMocks.posixSendto as any).mockImplementation(
      (_fd: number, packet: Buffer, _len: number) => {
        capturedId = packet.readUInt16BE(4);
        return 32;
      },
    );
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('accepts an echo reply from the probed target (id + source match)', async () => {
    (posixMocks.posixRecv as any).mockImplementation((_fd: number, buf: Buffer, _len: number) => {
      const reply = buildReply();
      reply.copy(buf);
      return reply.length;
    });
    vi.resetModules();
    const { icmpProbe, unloadIcmpLibraries } = await import('@src/native/IcmpProbe');

    const result = await icmpProbe({ target: '1.2.3.4', timeout: 1000 });

    expect(result.alive).toBe(true);
    expect(result.ip).toBe('1.2.3.4');

    unloadIcmpLibraries();
  });

  it('rejects a reply from a different source IP (concurrent-probe mismatch)', async () => {
    replySourceIp = '5.6.7.8';
    (posixMocks.posixRecv as any).mockImplementation((_fd: number, buf: Buffer, _len: number) => {
      const reply = buildReply();
      reply.copy(buf);
      return reply.length;
    });
    vi.resetModules();
    const { icmpProbe, unloadIcmpLibraries } = await import('@src/native/IcmpProbe');

    const result = await icmpProbe({ target: '1.2.3.4', timeout: 1000 });

    // Same id (raw socket broadcast), wrong source → treated as noise.
    expect(result.alive).toBe(false);
    expect(result.icmpStatus).toBe('UNEXPECTED_REPLY');

    unloadIcmpLibraries();
  });
});

describe('IcmpProbe POSIX default TTL from config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(process, 'platform', { value: 'linux' });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  /** Find the setsockopt(fd, IPPROTO_IP=0, IP_TTL=2, ...) call that set the TTL. */
  function ttlSetCalls(): number[] {
    return posixMocks.posixSetSockOpt.mock.calls
      .filter(([, level, optname]) => level === 0 && optname === 2)
      .map(([, , , buf]) => (buf as Buffer).readInt32LE(0));
  }

  it('uses ICMP_DEFAULT_TTL (128) when the caller does not override ttl', async () => {
    vi.resetModules();
    const { icmpProbe, unloadIcmpLibraries } = await import('@src/native/IcmpProbe');

    await icmpProbe({ target: '1.2.3.4', timeout: 1000 });

    expect(ttlSetCalls()).toContain(128);

    unloadIcmpLibraries();
  });

  it('honours an explicit ttl override', async () => {
    vi.resetModules();
    const { icmpProbe, unloadIcmpLibraries } = await import('@src/native/IcmpProbe');

    await icmpProbe({ target: '1.2.3.4', ttl: 64, timeout: 1000 });

    expect(ttlSetCalls()).toEqual([64]);

    unloadIcmpLibraries();
  });
});

describe('IcmpProbe POSIX Darwin sockaddr/TTL layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(process, 'platform', { value: 'darwin' });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('uses IP_TTL=4 and the BSD sockaddr_in byte layout', async () => {
    let capturedAddr: Buffer | undefined;
    (posixMocks.posixSendto as any).mockImplementation(
      (_fd: number, _buf: Buffer, _len: number, _flags: number, addr: Buffer) => {
        capturedAddr = Buffer.from(addr);
        return 32;
      },
    );

    vi.resetModules();
    const { icmpProbe, unloadIcmpLibraries } = await import('@src/native/IcmpProbe');
    await icmpProbe({ target: '1.2.3.4', ttl: 128, timeout: 1000 });

    // Darwin IP_TTL is 4 (2 would be IP_HDRINCL).
    const ttlCalls = posixMocks.posixSetSockOpt.mock.calls.filter(
      ([, level, optname]) => level === 0 && optname === 4,
    );
    expect(ttlCalls.length).toBeGreaterThan(0);
    expect((ttlCalls[0]![3] as Buffer).readInt32LE(0)).toBe(128);

    expect(capturedAddr).toBeDefined();
    expect(capturedAddr![0]).toBe(16); // sin_len
    expect(capturedAddr![1]).toBe(2); // sin_family = AF_INET
    expect([...capturedAddr!.subarray(4, 8)]).toEqual([1, 2, 3, 4]);

    unloadIcmpLibraries();
  });
});
