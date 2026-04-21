/**
 * Cross-platform ICMP probe and traceroute via koffi FFI.
 *
 * Windows: IcmpSendEcho from iphlpapi.dll (no admin required).
 * Linux/macOS: Raw ICMP sockets via libc (requires root/CAP_NET_RAW).
 *
 * Uses Buffer-based struct parsing (same pattern as Win32API.ts)
 * to avoid koffi struct registration issues in test environments.
 */

import koffi from 'koffi';
import { logger } from '@utils/logger';
import {
  ICMP_PROBE_TIMEOUT_MS,
  ICMP_TRACEROUTE_MAX_HOPS,
  ICMP_DEFAULT_PACKET_SIZE,
} from '@src/constants';

// ── Exported Types ──

export interface IcmpProbeResult {
  target: string;
  ip: string;
  alive: boolean;
  rtt: number | null;
  ttl: number;
  icmpStatus: string;
  errorClass: string;
  packetSize: number;
}

export interface TracerouteHop {
  hop: number;
  ip: string | null;
  rtt: number | null;
  status: string;
  errorClass: string;
}

export interface TracerouteResult {
  target: string;
  ip: string;
  hops: TracerouteHop[];
  reached: boolean;
  totalHops: number;
  totalTime: number;
}

// ── Shared Helpers ──

function ipToString(addr: number): string {
  return `${addr & 0xff}.${(addr >>> 8) & 0xff}.${(addr >>> 16) & 0xff}.${(addr >>> 24) & 0xff}`;
}

function isValidIpv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    const n = parseInt(p, 10);
    return !isNaN(n) && n >= 0 && n <= 255 && p === String(n);
  });
}

// ── Platform State ──

let _available: boolean | null = null;

// ════════════════════════════════════════════════════════════════════
// Windows Implementation (IcmpSendEcho via iphlpapi.dll)
// ════════════════════════════════════════════════════════════════════

const IP_STATUS: Record<number, string> = {
  0: 'SUCCESS',
  11001: 'BUF_TOO_SMALL',
  11002: 'DEST_NET_UNREACHABLE',
  11003: 'DEST_HOST_UNREACHABLE',
  11004: 'DEST_PROT_UNREACHABLE',
  11005: 'DEST_PORT_UNREACHABLE',
  11009: 'PACKET_TOO_BIG',
  11010: 'REQ_TIMED_OUT',
  11013: 'TTL_EXPIRED_TRANSIT',
  11014: 'TTL_EXPIRED_REASSEM',
  11015: 'PARAM_PROBLEM',
  11016: 'SOURCE_QUENCH',
  11050: 'GENERAL_FAILURE',
};

function winStatusLabel(s: number): string {
  return IP_STATUS[s] ?? `UNKNOWN_${s}`;
}

function winStatusClass(s: number): string {
  if (s === 0) return 'success';
  if (s === 11010) return 'timeout';
  if (s === 11013 || s === 11014) return 'time_exceeded';
  if (s >= 11002 && s <= 11005) return 'destination_unreachable';
  if (s === 11016) return 'source_quench';
  if (s === 11009) return 'packet_too_big';
  if (s === 11015) return 'parameter_problem';
  return 'error';
}

let iphlpapi: koffi.IKoffiLib | null = null;
let ws2_32: koffi.IKoffiLib | null = null;

function getIphlpapi(): koffi.IKoffiLib {
  if (!iphlpapi) {
    iphlpapi = koffi.load('iphlpapi.dll');
    logger.debug('Loaded iphlpapi.dll via koffi');
  }
  return iphlpapi;
}

function getWs2_32(): koffi.IKoffiLib {
  if (!ws2_32) {
    ws2_32 = koffi.load('ws2_32.dll');
    logger.debug('Loaded ws2_32.dll via koffi');
  }
  return ws2_32;
}

const IP_OPT_SIZE = 16;
const MIN_REPLY_BUF_SIZE = 256;
const ICMP_REPLY_OVERHEAD = 64;

function getReplyBufferSize(packetSize: number): number {
  // IcmpSendEcho expects room for the reply header, options, and echoed payload.
  return Math.max(MIN_REPLY_BUF_SIZE, packetSize + ICMP_REPLY_OVERHEAD);
}

function buildOptionBuf(ttl: number): Buffer {
  const buf = Buffer.alloc(IP_OPT_SIZE, 0);
  buf.writeUInt8(ttl, 0);
  return buf;
}

function parseReply(buf: Buffer) {
  return {
    address: buf.readUInt32LE(0),
    status: buf.readUInt32LE(4),
    rtt: buf.readUInt32LE(8),
  };
}

function win_inet_addr(ip: string): number {
  const fn = getWs2_32().func('uint32 inet_addr(char *)');
  return fn(ip);
}

function win_IcmpCreateFile(): bigint {
  const fn = getIphlpapi().func('void * IcmpCreateFile()');
  return fn();
}

function win_IcmpCloseHandle(h: bigint): boolean {
  const fn = getIphlpapi().func('int IcmpCloseHandle(void *)');
  return fn(h) !== 0;
}

function win_IcmpSendEcho(
  handle: bigint,
  destAddr: number,
  sendData: Buffer,
  optionBuf: Buffer,
  timeoutMs: number,
): { numReplies: number; replyBuf: Buffer } {
  const fn = getIphlpapi().func(
    'uint32 IcmpSendEcho(void *, uint32, void *, uint16, void *, void *, uint32, uint32)',
  );
  const replyBuf = Buffer.alloc(getReplyBufferSize(sendData.length));
  const n = fn(
    handle,
    destAddr,
    sendData,
    sendData.length,
    optionBuf,
    replyBuf,
    replyBuf.length,
    timeoutMs,
  );
  return { numReplies: Number(n), replyBuf };
}

function winIcmpProbe(params: {
  target: string;
  ttl?: number;
  packetSize?: number;
  timeout?: number;
}): IcmpProbeResult {
  const {
    target,
    ttl = 128,
    packetSize = ICMP_DEFAULT_PACKET_SIZE,
    timeout = ICMP_PROBE_TIMEOUT_MS,
  } = params;

  const destAddr = win_inet_addr(target);
  if (destAddr === 0xffffffff) {
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

  const handle = win_IcmpCreateFile();
  try {
    const sendData = Buffer.alloc(packetSize, 0xaa);
    const optionBuf = buildOptionBuf(ttl);
    const { numReplies, replyBuf } = win_IcmpSendEcho(
      handle,
      destAddr,
      sendData,
      optionBuf,
      timeout,
    );

    if (numReplies === 0) {
      return {
        target,
        ip: ipToString(destAddr),
        alive: false,
        rtt: null,
        ttl,
        icmpStatus: 'REQ_TIMED_OUT',
        errorClass: 'timeout',
        packetSize,
      };
    }

    const reply = parseReply(replyBuf);
    return {
      target,
      ip: ipToString(reply.address),
      alive: reply.status === 0,
      rtt: reply.status === 0 ? reply.rtt : null,
      ttl,
      icmpStatus: winStatusLabel(reply.status),
      errorClass: winStatusClass(reply.status),
      packetSize,
    };
  } finally {
    win_IcmpCloseHandle(handle);
  }
}

function winTraceroute(params: {
  target: string;
  maxHops?: number;
  timeout?: number;
  packetSize?: number;
}): TracerouteResult {
  const {
    target,
    maxHops = ICMP_TRACEROUTE_MAX_HOPS,
    timeout = ICMP_PROBE_TIMEOUT_MS,
    packetSize = ICMP_DEFAULT_PACKET_SIZE,
  } = params;

  const destAddr = win_inet_addr(target);
  if (destAddr === 0xffffffff) {
    return { target, ip: '', hops: [], reached: false, totalHops: 0, totalTime: 0 };
  }

  const handle = win_IcmpCreateFile();
  const hops: TracerouteHop[] = [];
  const t0 = performance.now();

  try {
    for (let ttl = 1; ttl <= maxHops; ttl++) {
      const sendData = Buffer.alloc(packetSize, 0xaa);
      const optionBuf = buildOptionBuf(ttl);
      const { numReplies, replyBuf } = win_IcmpSendEcho(
        handle,
        destAddr,
        sendData,
        optionBuf,
        timeout,
      );

      if (numReplies === 0) {
        hops.push({
          hop: ttl,
          ip: null,
          rtt: null,
          status: 'REQ_TIMED_OUT',
          errorClass: 'timeout',
        });
        continue;
      }

      const reply = parseReply(replyBuf);
      const hopIp = ipToString(reply.address);
      hops.push({
        hop: ttl,
        ip: hopIp,
        rtt: reply.rtt,
        status: winStatusLabel(reply.status),
        errorClass: winStatusClass(reply.status),
      });

      if (reply.status === 0) break;
    }
  } finally {
    win_IcmpCloseHandle(handle);
  }

  const last = hops[hops.length - 1];
  return {
    target,
    ip: ipToString(destAddr),
    hops,
    reached: last?.status === 'SUCCESS',
    totalHops: hops.length,
    totalTime: Math.round((performance.now() - t0) * 100) / 100,
  };
}

// ════════════════════════════════════════════════════════════════════
// POSIX Implementation (Linux + macOS via raw ICMP sockets)
// ════════════════════════════════════════════════════════════════════

const AF_INET = 2;
const SOCK_RAW = 3;
const IPPROTO_ICMP = 1;
const IPPROTO_IP = 0;
const IP_TTL = 2;
const SOL_SOCKET = 1;
const SO_RCVTIMEO = process.platform === 'darwin' ? 0x1006 : 20;
const POSIX_LIB = process.platform === 'darwin' ? '/usr/lib/libSystem.B.dylib' : 'libc.so.6';

let posixLib: koffi.IKoffiLib | null = null;

function getPosixLib(): koffi.IKoffiLib {
  if (!posixLib) {
    posixLib = koffi.load(POSIX_LIB);
    logger.debug(`Loaded ${POSIX_LIB} via koffi for ICMP`);
  }
  return posixLib;
}

function posixSocket(domain: number, type: number, protocol: number): number {
  const fn = getPosixLib().func('int socket(int, int, int)');
  return fn(domain, type, protocol);
}

function posixSetsockopt(
  fd: number,
  level: number,
  optname: number,
  optval: Buffer,
  optlen: number,
): number {
  const fn = getPosixLib().func('int setsockopt(int, int, int, void *, int)');
  return fn(fd, level, optname, optval, optlen);
}

function posixSendto(fd: number, buf: Buffer, addr: Buffer): number {
  const fn = getPosixLib().func('int sendto(int, void *, int, int, void *, int)');
  return fn(fd, buf, buf.length, 0, addr, 16);
}

function posixRecv(fd: number, buf: Buffer): number {
  const fn = getPosixLib().func('int recv(int, void *, int, int)');
  return fn(fd, buf, buf.length, 0);
}

function posixClose(fd: number): number {
  const fn = getPosixLib().func('int close(int)');
  return fn(fd);
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
  buf.writeUInt16LE(AF_INET, 0);
  const parts = ip.split('.').map(Number);
  buf[4] = parts[0] ?? 0;
  buf[5] = parts[1] ?? 0;
  buf[6] = parts[2] ?? 0;
  buf[7] = parts[3] ?? 0;
  return buf;
}

function parseIcmpPacket(
  buf: Buffer,
  n: number,
  expectedId: number,
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

function posixSetTtl(fd: number, ttl: number): void {
  const buf = Buffer.alloc(4);
  buf.writeInt32LE(ttl);
  posixSetsockopt(fd, IPPROTO_IP, IP_TTL, buf, 4);
}

function posixSetRecvTimeout(fd: number, timeoutMs: number): void {
  const tv = Buffer.alloc(16, 0);
  tv.writeInt32LE(Math.floor(timeoutMs / 1000), 0);
  tv.writeInt32LE((timeoutMs % 1000) * 1000, 8);
  posixSetsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, tv, 16);
}

function posixIcmpProbe(params: {
  target: string;
  ttl?: number;
  packetSize?: number;
  timeout?: number;
}): IcmpProbeResult {
  const {
    target,
    ttl = 128,
    packetSize = ICMP_DEFAULT_PACKET_SIZE,
    timeout = ICMP_PROBE_TIMEOUT_MS,
  } = params;

  if (!isValidIpv4(target)) {
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

  const fd = posixSocket(AF_INET, SOCK_RAW, IPPROTO_ICMP);
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
    posixSetTtl(fd, ttl);
    posixSetRecvTimeout(fd, timeout);

    const id = process.pid & 0xffff;
    const packet = buildIcmpEcho(id, 1, packetSize);
    const destAddr = buildSockaddrIn(target);

    const t0 = performance.now();
    const sent = posixSendto(fd, packet, destAddr);
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
    const n = posixRecv(fd, recvBuf);
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

    const reply = parseIcmpPacket(recvBuf, n, id);
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
      ip: ipToString(reply.fromIp),
      alive,
      rtt: alive ? rtt : null,
      ttl,
      icmpStatus: posixStatusLabel(reply.type, reply.code, false),
      errorClass: posixErrorClass(reply.type, reply.code, false),
      packetSize,
    };
  } finally {
    posixClose(fd);
  }
}

function posixTraceroute(params: {
  target: string;
  maxHops?: number;
  timeout?: number;
  packetSize?: number;
}): TracerouteResult {
  const {
    target,
    maxHops = ICMP_TRACEROUTE_MAX_HOPS,
    timeout = ICMP_PROBE_TIMEOUT_MS,
    packetSize = ICMP_DEFAULT_PACKET_SIZE,
  } = params;

  if (!isValidIpv4(target)) {
    return { target, ip: '', hops: [], reached: false, totalHops: 0, totalTime: 0 };
  }

  const fd = posixSocket(AF_INET, SOCK_RAW, IPPROTO_ICMP);
  if (fd < 0) {
    return { target, ip: '', hops: [], reached: false, totalHops: 0, totalTime: 0 };
  }

  const hops: TracerouteHop[] = [];
  const id = process.pid & 0xffff;
  const destAddr = buildSockaddrIn(target);
  const t0 = performance.now();

  try {
    posixSetRecvTimeout(fd, timeout);

    for (let ttl = 1; ttl <= maxHops; ttl++) {
      posixSetTtl(fd, ttl);
      const packet = buildIcmpEcho(id, ttl, packetSize);
      const sendT0 = performance.now();
      posixSendto(fd, packet, destAddr);

      const recvBuf = Buffer.alloc(512);
      const n = posixRecv(fd, recvBuf);
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

      const reply = parseIcmpPacket(recvBuf, n, id);
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
      hops.push({ hop: ttl, ip: ipToString(reply.fromIp), rtt, status, errorClass: errorCls });

      if (reply.type === 0) break;
    }
  } finally {
    posixClose(fd);
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

// ════════════════════════════════════════════════════════════════════
// Platform Dispatch
// ════════════════════════════════════════════════════════════════════

const isPosix = process.platform === 'linux' || process.platform === 'darwin';

export function isIcmpAvailable(): boolean {
  if (_available !== null) return _available;

  if (process.platform === 'win32') {
    try {
      const lib = koffi.load('iphlpapi.dll');
      lib.unload();
      _available = true;
      return true;
    } catch {
      _available = false;
      return false;
    }
  }

  if (isPosix) {
    try {
      const fd = posixSocket(AF_INET, SOCK_RAW, IPPROTO_ICMP);
      if (fd >= 0) {
        posixClose(fd);
        _available = true;
      } else {
        _available = false;
      }
    } catch {
      _available = false;
    }
    return _available;
  }

  _available = false;
  return false;
}

export function icmpProbe(params: {
  target: string;
  ttl?: number;
  packetSize?: number;
  timeout?: number;
}): IcmpProbeResult {
  const {
    target,
    ttl = 128,
    packetSize = ICMP_DEFAULT_PACKET_SIZE,
    timeout = ICMP_PROBE_TIMEOUT_MS,
  } = params;

  if (!isIcmpAvailable()) {
    return {
      target,
      ip: '',
      alive: false,
      rtt: null,
      ttl,
      icmpStatus: 'PLATFORM_NOT_SUPPORTED',
      errorClass: 'error',
      packetSize,
    };
  }

  if (process.platform === 'win32') {
    return winIcmpProbe({ target, ttl, packetSize, timeout });
  }

  return posixIcmpProbe({ target, ttl, packetSize, timeout });
}

export function traceroute(params: {
  target: string;
  maxHops?: number;
  timeout?: number;
  packetSize?: number;
}): TracerouteResult {
  const {
    target,
    maxHops = ICMP_TRACEROUTE_MAX_HOPS,
    timeout = ICMP_PROBE_TIMEOUT_MS,
    packetSize = ICMP_DEFAULT_PACKET_SIZE,
  } = params;

  if (!isIcmpAvailable()) {
    return { target, ip: '', hops: [], reached: false, totalHops: 0, totalTime: 0 };
  }

  if (process.platform === 'win32') {
    return winTraceroute({ target, maxHops, timeout, packetSize });
  }

  return posixTraceroute({ target, maxHops, timeout, packetSize });
}

export function unloadIcmpLibraries(): void {
  if (iphlpapi) {
    iphlpapi.unload();
    iphlpapi = null;
  }
  if (ws2_32) {
    ws2_32.unload();
    ws2_32 = null;
  }
  if (posixLib) {
    posixLib.unload();
    posixLib = null;
  }
  _available = null;
  logger.debug('Unloaded ICMP native libraries');
}
