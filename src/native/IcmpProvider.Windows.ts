/**
 * Windows ICMP Provider — IcmpSendEcho via iphlpapi.dll.
 *
 * No admin privileges required. Uses koffi FFI for native Windows API access.
 *
 * @module IcmpProvider.Windows
 */

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

// ── Win32 API Types ──

type WinIcmpSendEchoFn = ((
  handle: bigint,
  destAddr: number,
  sendData: Buffer,
  sendLength: number,
  options: Buffer,
  replyBuf: Buffer,
  replySize: number,
  timeoutMs: number,
) => number) & {
  async: (
    handle: bigint,
    destAddr: number,
    sendData: Buffer,
    sendLength: number,
    options: Buffer,
    replyBuf: Buffer,
    replySize: number,
    timeoutMs: number,
    callback: (err: unknown, result: number) => void,
  ) => void;
};

type WinIcmpFns = {
  inetAddr: (ip: string) => number;
  createFile: () => bigint;
  closeHandle: (handle: bigint) => number;
  sendEcho: WinIcmpSendEchoFn;
};

// ── Status Mapping ──

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

// ── FFI Loader ──

let iphlpapi: LibraryHandle | null = null;
let ws2_32: LibraryHandle | null = null;
let winIcmpFns: WinIcmpFns | null = null;

function getIphlpapi(): LibraryHandle {
  if (!iphlpapi) {
    iphlpapi = requireKoffi().load('iphlpapi.dll');
    logger.debug('Loaded iphlpapi.dll via koffi');
  }
  return iphlpapi;
}

function getWs2_32(): LibraryHandle {
  if (!ws2_32) {
    ws2_32 = requireKoffi().load('ws2_32.dll');
    logger.debug('Loaded ws2_32.dll via koffi');
  }
  return ws2_32;
}

function getWinIcmpFns(): WinIcmpFns {
  if (!winIcmpFns) {
    const iphlpapiLib = getIphlpapi();
    const ws2Lib = getWs2_32();
    const sendEcho = iphlpapiLib.func(
      'uint32 IcmpSendEcho(void *, uint32, void *, uint16, void *, void *, uint32, uint32)',
    ) as WinIcmpSendEchoFn;
    winIcmpFns = {
      inetAddr: ws2Lib.func('uint32 inet_addr(char *)'),
      createFile: iphlpapiLib.func('void * IcmpCreateFile()'),
      closeHandle: iphlpapiLib.func('int IcmpCloseHandle(void *)'),
      sendEcho,
    };
  }
  return winIcmpFns;
}

// ── Buffer Helpers ──

const IP_OPT_SIZE = 16;
const MIN_REPLY_BUF_SIZE = 256;
const ICMP_REPLY_OVERHEAD = 64;
/** inet_addr() failure marker (255.255.255.255 in network byte order). */
const INET_ADDR_ERROR = 0xffffffff;

function getReplyBufferSize(packetSize: number): number {
  return Math.max(MIN_REPLY_BUF_SIZE, packetSize + ICMP_REPLY_OVERHEAD);
}

function buildOptionBuf(ttl: number): Buffer {
  const buf = Buffer.alloc(IP_OPT_SIZE, 0);
  buf.writeUInt8(ttl, 0);
  return buf;
}

/**
 * Issue one IcmpSendEcho round-trip. Shared by probe() and traceroute() —
 * previously the async-callback promise wrapper was duplicated verbatim.
 */
function sendEchoOnce(
  fns: WinIcmpFns,
  handle: bigint,
  destAddr: number,
  packetSize: number,
  ttl: number,
  timeout: number,
): Promise<{ numReplies: number; replyBuf: Buffer }> {
  const sendData = Buffer.alloc(packetSize, 0xaa);
  const optionBuf = buildOptionBuf(ttl);
  const replyBuf = Buffer.alloc(getReplyBufferSize(packetSize));

  return new Promise((resolve, reject) => {
    fns.sendEcho.async(
      handle,
      destAddr,
      sendData,
      sendData.length,
      optionBuf,
      replyBuf,
      replyBuf.length,
      timeout,
      (err, result) => {
        if (err) {
          reject(err);
          return;
        }
        resolve({ numReplies: Number(result), replyBuf });
      },
    );
  });
}

function parseReply(buf: Buffer): { address: number; status: number; rtt: number } {
  // ICMP_ECHO_REPLY layout is identical on x86/x64 for the leading fields
  // because Address is IPAddr (a 4-byte ULONG), not a pointer:
  //   Address(ULONG @0) Status(@4) RoundTripTime(@8) DataSize(@12) Reserved(@14)
  // Only the trailing Data/Options pointers change width. Reading 64-bit
  // offsets shifts Status->RoundTripTime and RoundTripTime->DataSize|Reserved.
  if (buf.length < 12) {
    return { address: 0, status: 0xffffffff, rtt: 0 };
  }
  return {
    address: buf.readUInt32LE(0),
    status: buf.readUInt32LE(4),
    rtt: buf.readUInt32LE(8),
  };
}

// ── Windows Provider ──

export class WindowsIcmpProvider extends BaseIcmpProvider {
  private static cachedInstance: WindowsIcmpProvider | null = null;

  static instance(): WindowsIcmpProvider {
    if (!this.cachedInstance) {
      this.cachedInstance = new WindowsIcmpProvider();
    }
    return this.cachedInstance;
  }

  private constructor() {
    super();
  }

  isAvailable(): boolean {
    if (process.platform !== 'win32') return false;
    try {
      const lib = requireKoffi().load('iphlpapi.dll');
      lib.unload();
      return true;
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

    const fns = getWinIcmpFns();
    const destAddr = fns.inetAddr(target);
    if (destAddr === INET_ADDR_ERROR) {
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

    const handle = fns.createFile();
    try {
      const { numReplies, replyBuf } = await sendEchoOnce(
        fns,
        handle,
        destAddr,
        packetSize,
        ttl,
        timeout,
      );

      if (numReplies === 0) {
        return {
          target,
          ip: this.ipToString(destAddr),
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
        ip: this.ipToString(reply.address),
        alive: reply.status === 0,
        rtt: reply.status === 0 ? reply.rtt : null,
        ttl,
        icmpStatus: winStatusLabel(reply.status),
        errorClass: winStatusClass(reply.status),
        packetSize,
      };
    } finally {
      fns.closeHandle(handle);
    }
  }

  async traceroute(params: TracerouteParams): Promise<TracerouteResult> {
    const {
      target,
      maxHops = ICMP_TRACEROUTE_MAX_HOPS,
      timeout = ICMP_PROBE_TIMEOUT_MS,
      packetSize = ICMP_DEFAULT_PACKET_SIZE,
    } = params;

    const fns = getWinIcmpFns();
    const destAddr = fns.inetAddr(target);
    if (destAddr === INET_ADDR_ERROR) {
      return { target, ip: '', hops: [], reached: false, totalHops: 0, totalTime: 0 };
    }

    const handle = fns.createFile();
    const hops: TracerouteHop[] = [];
    const t0 = performance.now();

    try {
      for (let ttl = 1; ttl <= maxHops; ttl++) {
        const { numReplies, replyBuf } = await sendEchoOnce(
          fns,
          handle,
          destAddr,
          packetSize,
          ttl,
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
        const hopIp = this.ipToString(reply.address);
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
      fns.closeHandle(handle);
    }

    const last = hops[hops.length - 1];
    return {
      target,
      ip: this.ipToString(destAddr),
      hops,
      reached: last?.status === 'SUCCESS',
      totalHops: hops.length,
      totalTime: Math.round((performance.now() - t0) * 100) / 100,
    };
  }

  static unloadLibraries(): void {
    if (iphlpapi) {
      iphlpapi.unload();
      iphlpapi = null;
    }
    if (ws2_32) {
      ws2_32.unload();
      ws2_32 = null;
    }
    winIcmpFns = null;
    logger.debug('Unloaded Windows ICMP libraries');
  }
}
