/**
 * POSIX ICMP Provider — raw ICMP sockets via libc (Linux/macOS).
 *
 * Requires root privileges or CAP_NET_RAW capability.
 *
 * @module IcmpProvider.Posix
 */

import { randomBytes } from 'node:crypto';
import type { LibraryHandle } from 'koffi';
import { requireKoffi } from './koffi-loader';
import { logger } from '@utils/logger';
import {
  ICMP_PROBE_TIMEOUT_MS,
  ICMP_TRACEROUTE_MAX_HOPS,
  ICMP_DEFAULT_PACKET_SIZE,
  ICMP_DEFAULT_TTL,
} from '@src/constants';
import {
  BaseIcmpProvider,
  type IcmpProbeParams,
  type TracerouteParams,
  type IcmpProbeResult,
  type TracerouteResult,
  type TracerouteHop,
} from './IcmpProvider.js';

// ── POSIX Constants ──

const AF_INET = 2;
const SOCK_RAW = 3;
const IPPROTO_ICMP = 1;
const IPPROTO_IP = 0;
// IP_TTL is 2 on Linux but 4 on macOS/BSD (2 is IP_HDRINCL on Darwin, which
// would make the kernel expect a caller-supplied IP header).
const IP_TTL = process.platform === 'darwin' ? 4 : 2;
const SOL_SOCKET = 1;
const SO_RCVTIMEO = process.platform === 'darwin' ? 0x1006 : 20;
const POSIX_LIB = process.platform === 'darwin' ? '/usr/lib/libSystem.B.dylib' : 'libc.so.6';

// ── POSIX API Types ──

type PosixFns = {
  socket: (domain: number, type: number, protocol: number) => number;
  setsockopt: (
    fd: number,
    level: number,
    optname: number,
    optval: Buffer,
    optlen: number,
  ) => number;
  sendto: (
    fd: number,
    buf: Buffer,
    len: number,
    flags: number,
    addr: Buffer,
    addrLen: number,
  ) => number;
  recv: (fd: number, buf: Buffer, len: number, flags: number) => number;
  close: (fd: number) => number;
};

// ── FFI Loader ──

let posixLib: LibraryHandle | null = null;
let posixFns: PosixFns | null = null;

function getPosixLib(): LibraryHandle {
  if (!posixLib) {
    posixLib = requireKoffi().load(POSIX_LIB);
    logger.debug(`Loaded ${POSIX_LIB} via koffi for ICMP`);
  }
  return posixLib;
}

function getPosixFns(): PosixFns {
  if (!posixFns) {
    const lib = getPosixLib();
    posixFns = {
      socket: lib.func('int socket(int, int, int)'),
      setsockopt: lib.func('int setsockopt(int, int, int, void *, int)'),
      sendto: lib.func('int sendto(int, void *, int, int, void *, int)'),
      recv: lib.func('int recv(int, void *, int, int)'),
      close: lib.func('int close(int)'),
    };
  }
  return posixFns;
}

// ── ICMP Packet Helpers ──

function computeChecksum(buf: Buffer): number {
  let sum = 0;
  for (let i = 0; i < buf.length - 1; i += 2) {
    sum += buf.readUInt16BE(i);
  }
  if (buf.length & 1) {
    sum += (buf[buf.length - 1] ?? 0) << 8;
  }
  while (sum > 0xffff) {
    sum = (sum & 0xffff) + (sum >>> 16);
  }
  return ~sum & 0xffff;
}

function buildIcmpEcho(id: number, seq: number, payloadSize: number): Buffer {
  const buf = Buffer.alloc(8 + payloadSize);
  buf[0] = 8; // Type: Echo Request
  buf[1] = 0; // Code
  buf.writeUInt16BE(id & 0xffff, 4);
  buf.writeUInt16BE(seq & 0xffff, 6);
  for (let i = 8; i < buf.length; i++) {
    buf[i] = 0xaa;
  }
  buf.writeUInt16BE(computeChecksum(buf), 2);
  return buf;
}

function buildSockaddrIn(ip: string): Buffer {
  const buf = Buffer.alloc(16, 0);
  if (process.platform === 'darwin') {
    // Darwin/BSD sockaddr_in: sin_len(1) at 0, sin_family(1) at 1,
    // sin_port(2) at 2 (network order), sin_addr(4) at 4.
    buf[0] = 16; // sizeof(struct sockaddr_in)
    buf[1] = AF_INET;
  } else {
    // Linux: sin_family(2) at 0, sin_port(2) at 2, sin_addr(4) at 4.
    buf.writeUInt16LE(AF_INET, 0);
  }
  const parts = ip.split('.').map(Number);
  buf[4] = parts[0] ?? 0;
  buf[5] = parts[1] ?? 0;
  buf[6] = parts[2] ?? 0;
  buf[7] = parts[3] ?? 0;
  return buf;
}

/**
 * Parse an ICMP reply. `expectedIp` is the probed target's IPv4 address in
 * network-byte order (the value `buf.readUInt32LE(12)` yields for the source
 * address in the IP header).
 *
 * Source validation is applied to Echo Replies only: an echo reply to OUR
 * probe must come from the probed target. Without it, a raw ICMP socket
 * receives every matching-id packet on the host — with all probes sharing
 * `process.pid` as the id, a concurrent probe's reply gets misattributed.
 * Time Exceeded / Dest Unreachable legitimately arrive from intermediate
 * routers (traceroute), so those only check the embedded id.
 */
function parseIcmpPacket(
  buf: Buffer,
  n: number,
  expectedId: number,
  expectedIp: number,
): { type: number; code: number; fromIp: number } | null {
  if (n < 20) return null;
  const ihl = ((buf[0] ?? 0) & 0x0f) * 4;
  if (n < ihl + 8) return null;

  const icmpType = buf[ihl] ?? 0;
  const icmpCode = buf[ihl + 1] ?? 0;
  const fromIp = buf.readUInt32LE(12);

  if (icmpType === 0) {
    // Echo Reply
    const id = buf.readUInt16BE(ihl + 4);
    if (id !== expectedId) return null;
    if (fromIp !== expectedIp) return null;
    return { type: icmpType, code: icmpCode, fromIp };
  }

  if (icmpType === 11 || icmpType === 3) {
    // Time Exceeded or Dest Unreachable
    const origStart = ihl + 8;
    if (n < origStart + 28) return null;
    const origIhl = ((buf[origStart] ?? 0) & 0x0f) * 4;
    if (n < origStart + origIhl + 8) return null;
    const origId = buf.readUInt16BE(origStart + origIhl + 4);
    if (origId !== expectedId) return null;
    return { type: icmpType, code: icmpCode, fromIp };
  }

  return null;
}

/**
 * Per-probe random ICMP identifier. The raw socket receives every packet on
 * the host whose id matches ours, so probes must NOT share `process.pid` as
 * the id — two concurrent probes to the same target would otherwise
 * cross-attribute each other's replies.
 */
function randomIcmpId(): number {
  return randomBytes(2).readUInt16BE(0);
}

function posixStatusLabel(type: number, code: number, timedOut: boolean): string {
  if (type === 0) return 'SUCCESS';
  if (timedOut) return 'REQ_TIMED_OUT';
  if (type === 11 && code === 0) return 'TTL_EXPIRED_TRANSIT';
  if (type === 11 && code === 1) return 'TTL_EXPIRED_REASSEM';
  if (type === 3 && code === 0) return 'DEST_NET_UNREACHABLE';
  if (type === 3 && code === 1) return 'DEST_HOST_UNREACHABLE';
  if (type === 3 && code === 2) return 'DEST_PROT_UNREACHABLE';
  if (type === 3 && code === 3) return 'DEST_PORT_UNREACHABLE';
  return `UNKNOWN_${type}_${code}`;
}

function posixErrorClass(type: number, _code: number, timedOut: boolean): string {
  if (type === 0) return 'success';
  if (timedOut) return 'timeout';
  if (type === 11) return 'time_exceeded';
  if (type === 3) return 'destination_unreachable';
  return 'error';
}

// ── POSIX Provider ──

export class PosixIcmpProvider extends BaseIcmpProvider {
  private static cachedInstance: PosixIcmpProvider | null = null;

  static instance(): PosixIcmpProvider {
    if (!this.cachedInstance) {
      this.cachedInstance = new PosixIcmpProvider();
    }
    return this.cachedInstance;
  }

  private constructor() {
    super();
  }

  isAvailable(): boolean {
    if (process.platform !== 'linux' && process.platform !== 'darwin') return false;
    try {
      const fns = getPosixFns();
      const fd = fns.socket(AF_INET, SOCK_RAW, IPPROTO_ICMP);
      if (fd >= 0) {
        fns.close(fd);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  async probe(params: IcmpProbeParams): Promise<IcmpProbeResult> {
    const {
      target,
      ttl = ICMP_DEFAULT_TTL,
      packetSize = ICMP_DEFAULT_PACKET_SIZE,
      timeout = ICMP_PROBE_TIMEOUT_MS,
    } = params;

    if (!this.validateIp(target)) {
      return {
        target,
        ip: '',
        alive: false,
        rtt: null,
        ttl,
        icmpStatus: 'INVALID_ADDRESS',
        errorClass: 'error',
        packetSize,
      };
    }

    const fns = getPosixFns();
    const fd = fns.socket(AF_INET, SOCK_RAW, IPPROTO_ICMP);
    if (fd < 0) {
      return {
        target,
        ip: '',
        alive: false,
        rtt: null,
        ttl,
        icmpStatus: 'SOCKET_ERROR',
        errorClass: 'error',
        packetSize,
      };
    }

    try {
      this.setTtl(fns, fd, ttl);
      this.setRecvTimeout(fns, fd, timeout);

      const id = randomIcmpId();
      const packet = buildIcmpEcho(id, 1, packetSize);
      const destAddr = buildSockaddrIn(target);

      const t0 = performance.now();
      const sent = fns.sendto(fd, packet, packet.length, 0, destAddr, 16);
      if (sent < 0) {
        return {
          target,
          ip: target,
          alive: false,
          rtt: null,
          ttl,
          icmpStatus: 'SEND_ERROR',
          errorClass: 'error',
          packetSize,
        };
      }

      const recvBuf = Buffer.alloc(512);
      const n = fns.recv(fd, recvBuf, recvBuf.length, 0);
      const rtt = Math.round(performance.now() - t0);

      if (n <= 0) {
        return {
          target,
          ip: target,
          alive: false,
          rtt: null,
          ttl,
          icmpStatus: 'REQ_TIMED_OUT',
          errorClass: 'timeout',
          packetSize,
        };
      }

      const reply = parseIcmpPacket(recvBuf, n, id, destAddr.readUInt32LE(4));
      if (!reply) {
        return {
          target,
          ip: target,
          alive: false,
          rtt: null,
          ttl,
          icmpStatus: 'UNEXPECTED_REPLY',
          errorClass: 'error',
          packetSize,
        };
      }

      const alive = reply.type === 0;
      return {
        target,
        ip: this.ipToString(reply.fromIp),
        alive,
        rtt: alive ? rtt : null,
        ttl,
        icmpStatus: posixStatusLabel(reply.type, reply.code, false),
        errorClass: posixErrorClass(reply.type, reply.code, false),
        packetSize,
      };
    } finally {
      fns.close(fd);
    }
  }

  async traceroute(params: TracerouteParams): Promise<TracerouteResult> {
    const {
      target,
      maxHops = ICMP_TRACEROUTE_MAX_HOPS,
      timeout = ICMP_PROBE_TIMEOUT_MS,
      packetSize = ICMP_DEFAULT_PACKET_SIZE,
    } = params;

    if (!this.validateIp(target)) {
      return { target, ip: '', hops: [], reached: false, totalHops: 0, totalTime: 0 };
    }

    const fns = getPosixFns();
    const fd = fns.socket(AF_INET, SOCK_RAW, IPPROTO_ICMP);
    if (fd < 0) {
      return { target, ip: '', hops: [], reached: false, totalHops: 0, totalTime: 0 };
    }

    const hops: TracerouteHop[] = [];
    const destAddr = buildSockaddrIn(target);
    const expectedIp = destAddr.readUInt32LE(4);
    const t0 = performance.now();

    const MAX_CONSECUTIVE_SEND_ERRORS = 5;
    let consecutiveSendErrors = 0;

    try {
      this.setRecvTimeout(fns, fd, timeout);

      for (let ttl = 1; ttl <= maxHops; ttl++) {
        this.setTtl(fns, fd, ttl);
        // Fresh random id per hop: the raw socket is shared with concurrent
        // probes, so a reused id could pull in another probe's reply.
        const id = randomIcmpId();
        const packet = buildIcmpEcho(id, ttl, packetSize);
        const sendT0 = performance.now();
        const sent = fns.sendto(fd, packet, packet.length, 0, destAddr, 16);
        if (sent < 0) {
          consecutiveSendErrors++;
          hops.push({
            hop: ttl,
            ip: null,
            rtt: null,
            status: 'SEND_ERROR',
            errorClass: 'error',
          });
          if (consecutiveSendErrors >= MAX_CONSECUTIVE_SEND_ERRORS) break;
          continue;
        }
        consecutiveSendErrors = 0;

        const recvBuf = Buffer.alloc(512);
        const n = fns.recv(fd, recvBuf, recvBuf.length, 0);
        const rtt = Math.round(performance.now() - sendT0);

        if (n <= 0) {
          hops.push({
            hop: ttl,
            ip: null,
            rtt: null,
            status: 'REQ_TIMED_OUT',
            errorClass: 'timeout',
          });
          continue;
        }

        const reply = parseIcmpPacket(recvBuf, n, id, expectedIp);
        if (!reply) {
          hops.push({
            hop: ttl,
            ip: null,
            rtt: null,
            status: 'UNEXPECTED_REPLY',
            errorClass: 'error',
          });
          continue;
        }

        const status = posixStatusLabel(reply.type, reply.code, false);
        const errorCls = posixErrorClass(reply.type, reply.code, false);
        hops.push({
          hop: ttl,
          ip: this.ipToString(reply.fromIp),
          rtt,
          status,
          errorClass: errorCls,
        });

        if (reply.type === 0) break;
      }
    } finally {
      fns.close(fd);
    }

    const last = hops[hops.length - 1];
    return {
      target,
      ip: target,
      hops,
      reached: last?.status === 'SUCCESS',
      totalHops: hops.length,
      totalTime: Math.round((performance.now() - t0) * 100) / 100,
    };
  }

  private setTtl(fns: PosixFns, fd: number, ttl: number): void {
    const buf = Buffer.alloc(4);
    buf.writeInt32LE(ttl);
    fns.setsockopt(fd, IPPROTO_IP, IP_TTL, buf, 4);
  }

  private setRecvTimeout(fns: PosixFns, fd: number, timeoutMs: number): void {
    const tv = Buffer.alloc(16, 0);
    tv.writeInt32LE(Math.floor(timeoutMs / 1000), 0);
    tv.writeInt32LE((timeoutMs % 1000) * 1000, 8);
    fns.setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, tv, 16);
  }

  static unloadLibraries(): void {
    if (posixLib) {
      posixLib.unload();
      posixLib = null;
    }
    posixFns = null;
    logger.debug('Unloaded POSIX ICMP libraries');
  }
}
