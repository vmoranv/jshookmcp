/**
 * GDB Remote Serial Protocol (RSP) TCP server.
 *
 * Listens on a TCP port for GDB client connections, handles RSP packet
 * framing ($data#checksum, ACK/NAK), and dispatches commands to the
 * nemu emulator session (registers, memory, step/continue/trace).
 *
 * Commands supported:
 *   ?   halt reason       g/G  read/write registers
 *   m/M  read/write memory  s    single-step
 *   c    continue            Z0/z0 software breakpoints
 *   vCont extended continue  qSupported feature negotiation
 *   qXfer target description  qfThreadInfo/qsThreadInfo thread listing
 *   Hc/Hg set current thread
 *
 * @module native/GdbRspServer
 */

import * as net from 'node:net';
import type { Socket } from 'node:net';
import { EventEmitter } from 'node:events';
import type { GdbEmulatorSession, GdbEmulatorEngine } from './GdbRspServer.types.js';
import {
  GDB_REG_NAMES,
  decodeRspPacket,
  encodeRspPacket,
  rleEncode,
  bytesToHex,
  hexToBytes,
  generateTargetXml,
  generateThreadsXml,
} from './GdbRspProtocol';

// ── types ───────────────────────────────────────────────────────────────────

export interface GdbServerConfig {
  host: string;
  port: number;
  sessionId: string;
  /** Called to resolve the emulator session on each command. */
  getSession: (sessionId: string) => GdbEmulatorSession;
}

export interface GdbClientInfo {
  id: number;
  remoteAddress: string;
  connectedAt: Date;
  bytesReceived: number;
  bytesSent: number;
  packetsReceived: number;
  packetsSent: number;
}

export interface GdbServerStatus {
  running: boolean;
  host: string;
  port: number;
  sessionId: string;
  clients: GdbClientInfo[];
  totalConnections: number;
  startedAt: Date | null;
  noAckMode: boolean;
}

/**
 * Apply an RSP `M addr,len:hex` payload to an emulator engine.
 *
 * Returns false when the payload is malformed or the engine has no write
 * surface — callers must then answer with an error packet, never `OK`.
 */
export function applyGdbMemoryWrite(
  engine: GdbEmulatorEngine,
  address: number,
  len: number,
  hexData: string,
): boolean {
  if (!/^[0-9a-fA-F]*$/.test(hexData) || hexData.length !== len * 2) {
    return false;
  }
  if (typeof engine.writeMemory !== 'function') {
    return false;
  }
  try {
    engine.writeMemory(address, hexToBytes(hexData));
    return true;
  } catch {
    return false;
  }
}

// ── server implementation ───────────────────────────────────────────────────

export class GdbRspServer extends EventEmitter {
  private config: GdbServerConfig;
  private server: net.Server | null = null;
  private clients = new Map<number, { socket: Socket; info: GdbClientInfo }>();
  private nextClientId = 1;
  private totalConnections = 0;
  private startedAt: Date | null = null;
  private noAckMode = false;
  private serverRunning = false;

  constructor(config: GdbServerConfig) {
    super();
    this.config = config;
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  get running(): boolean {
    return this.serverRunning;
  }

  get status(): GdbServerStatus {
    // Read the actual bound port from the server (important when port: 0 was used).
    const actualPort = this.server
      ? ((this.server.address() as net.AddressInfo)?.port ?? this.config.port)
      : this.config.port;

    return {
      running: this.serverRunning,
      host: this.config.host,
      port: actualPort,
      sessionId: this.config.sessionId,
      clients: Array.from(this.clients.values()).map((c) => ({ ...c.info })),
      totalConnections: this.totalConnections,
      startedAt: this.startedAt,
      noAckMode: this.noAckMode,
    };
  }

  async start(): Promise<void> {
    if (this.serverRunning) return;

    return new Promise<void>((resolve, reject) => {
      this.server = net.createServer((socket) => this.handleConnection(socket));

      this.server.on('error', (err) => {
        this.serverRunning = false;
        reject(err);
      });

      this.server.listen(this.config.port, this.config.host, () => {
        this.serverRunning = true;
        this.startedAt = new Date();
        this.emit('started', { host: this.config.host, port: this.config.port });
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.serverRunning) return;

    return new Promise<void>((resolve) => {
      // Close all client sockets.
      for (const [, client] of this.clients) {
        client.socket.destroy();
      }
      this.clients.clear();

      if (this.server) {
        this.server.close(() => {
          this.serverRunning = false;
          this.server = null;
          this.startedAt = null;
          this.emit('stopped');
          resolve();
        });
      } else {
        this.serverRunning = false;
        resolve();
      }
    });
  }

  // ── connection handling ──────────────────────────────────────────────────

  private handleConnection(socket: Socket): void {
    const id = this.nextClientId++;
    this.totalConnections++;

    const info: GdbClientInfo = {
      id,
      remoteAddress: `${socket.remoteAddress}:${socket.remotePort}`,
      connectedAt: new Date(),
      bytesReceived: 0,
      bytesSent: 0,
      packetsReceived: 0,
      packetsSent: 0,
    };

    this.clients.set(id, { socket, info });
    this.emit('client-connected', info);

    let buffer = '';

    socket.on('data', (chunk: Buffer) => {
      info.bytesReceived += chunk.length;
      buffer += chunk.toString('utf8');

      // Process complete packets delimited by $
      while (true) {
        // Look for ACK/NAK at start
        if (buffer.startsWith('+')) {
          buffer = buffer.slice(1);
          continue;
        }
        if (buffer.startsWith('-')) {
          buffer = buffer.slice(1);
          // Client sent NAK — resend last response if we tracked it.
          continue;
        }
        // Interrupt (Ctrl-C): 0x03
        if (buffer.startsWith('\x03')) {
          buffer = buffer.slice(1);
          // Send halt reason immediately.
          this.sendResponse(socket, info, encodeRspPacket('S02'));
          continue;
        }

        const dollarIdx = buffer.indexOf('$');
        if (dollarIdx < 0) {
          // No packet start found — discard noise or wait for more data.
          if (buffer.length > 0 && dollarIdx < 0) {
            // Keep the buffer for incomplete packets.
            break;
          }
          buffer = '';
          break;
        }

        // Discard anything before $ (GDB spec: ignore stray chars)
        if (dollarIdx > 0) {
          buffer = buffer.slice(dollarIdx);
        }

        // Find the end of packet (#checksum)
        const hashIdx = buffer.indexOf('#');
        if (hashIdx < 0) {
          // Incomplete packet — wait for more data.
          break;
        }

        // Need 2 more chars after # for checksum
        if (buffer.length < hashIdx + 3) {
          break;
        }

        const packet = buffer.slice(0, hashIdx + 3);
        buffer = buffer.slice(hashIdx + 3);
        info.packetsReceived++;

        // Send ACK unless in no-ack mode.
        if (!this.noAckMode) {
          socket.write('+');
          info.bytesSent++;
        }

        const response = this.processPacket(packet);
        this.sendResponse(socket, info, response);
      }
    });

    socket.on('close', () => {
      this.clients.delete(id);
      this.emit('client-disconnected', info);
    });

    socket.on('error', (err) => {
      this.emit('client-error', { id, error: err.message });
      this.clients.delete(id);
    });
  }

  private sendResponse(socket: Socket, info: GdbClientInfo, response: string): void {
    // response is already RSP-encoded ($data#checksum)
    const buf = Buffer.from(response, 'utf8');
    socket.write(buf);
    info.bytesSent += buf.length;
    info.packetsSent++;
  }

  // ── packet dispatch ───────────────────────────────────────────────────────

  private processPacket(packet: string): string {
    const { data, valid } = decodeRspPacket(packet);
    if (!valid) {
      return encodeRspPacket('E01');
    }

    // Handle qSupported for no-ack mode and feature negotiation.
    if (data.startsWith('qSupported')) {
      return this.handleQSupported(data);
    }

    // Handle QStartNoAckMode
    if (data === 'QStartNoAckMode') {
      this.noAckMode = true;
      return encodeRspPacket('OK');
    }

    // Handle vCont
    if (data.startsWith('vCont')) {
      return this.handleVCont(data);
    }

    // Handle qXfer
    if (data.startsWith('qXfer')) {
      return this.handleQXfer(data);
    }

    // Handle qfThreadInfo / qsThreadInfo
    if (data.startsWith('qfThreadInfo') || data.startsWith('qsThreadInfo')) {
      return encodeRspPacket('m1'); // Thread 1 only
    }

    // Handle qC (current thread)
    if (data === 'qC') {
      return encodeRspPacket('QC1');
    }

    // Handle qAttached
    if (data === 'qAttached' || data === 'qAttached:1') {
      return encodeRspPacket('1'); // Attached to an existing process
    }

    // Handle qOffsets
    if (data === 'qOffsets') {
      return encodeRspPacket('Text=0;Data=0;Bss=0');
    }

    // Handle qSymbol (no symbol lookup needed)
    if (data.startsWith('qSymbol')) {
      return encodeRspPacket('OK');
    }

    // Handle qTStatus (trace status — no trace experiments)
    if (data === 'qTStatus') {
      return encodeRspPacket('T0');
    }

    // Handle Hc / Hg — set thread for continue/general operations
    if (data.startsWith('Hc') || data.startsWith('Hg')) {
      // Accept any thread (we only have thread 1)
      return encodeRspPacket('OK');
    }

    // Handle T (thread alive check)
    if (data.startsWith('T')) {
      const tid = data.slice(1);
      return tid === '1' ? encodeRspPacket('OK') : encodeRspPacket('E01');
    }

    // Handle packets with a simple command prefix
    const cmd = data[0];
    if (!cmd) return encodeRspPacket('');

    try {
      switch (cmd) {
        case '?':
          return this.handleHaltReason();
        case 'g':
          return this.handleReadRegisters();
        case 'G':
          return this.handleWriteRegisters(data.slice(1));
        case 'm':
          return this.handleReadMemory(data);
        case 'M':
          return this.handleWriteMemory(data);
        case 's':
          return this.handleStep();
        case 'c':
          return this.handleContinue(data);
        case 'Z':
          return this.handleSetBreakpoint(data);
        case 'z':
          return this.handleClearBreakpoint(data);
        case 'D':
          return this.handleDetach();
        case 'k':
          return this.handleKill();
        default:
          return encodeRspPacket(''); // Empty response = unsupported
      }
    } catch (err) {
      this.emit('command-error', { command: cmd, error: String(err) });
      return encodeRspPacket(`E${String(err).length.toString(16).padStart(2, '0')}`);
    }
  }

  // ── command handlers ──────────────────────────────────────────────────────

  private handleQSupported(_data: string): string {
    // Advertise supported features
    const features = [
      'PacketSize=3fff',
      'QStartNoAckMode+',
      'qXfer:features:read+',
      'qXfer:threads:read+',
      'vContSupported+',
      'multiprocess+',
      'swbreak+',
      'hwbreak-',
      'no-resumed+',
    ];
    return encodeRspPacket(features.join(';'));
  }

  private handleHaltReason(): string {
    return encodeRspPacket('S05'); // SIGTRAP
  }

  private handleReadRegisters(): string {
    const session = this.config.getSession(this.config.sessionId);
    const eng = session.emulator.engine;
    const regHex = GDB_REG_NAMES.map((name) => {
      try {
        const val = eng.readRegister(name);
        return val.toString(16).padStart(16, '0');
      } catch {
        return '0000000000000000';
      }
    }).join('');
    return encodeRspPacket(rleEncode(regHex));
  }

  private handleWriteRegisters(hexData: string): string {
    const session = this.config.getSession(this.config.sessionId);
    const eng = session.emulator.engine;
    for (let i = 0; i < GDB_REG_NAMES.length && i * 16 + 16 <= hexData.length; i++) {
      const chunk = hexData.slice(i * 16, i * 16 + 16);
      try {
        const val = parseInt(chunk, 16);
        if (!Number.isNaN(val)) {
          eng.writeRegister(GDB_REG_NAMES[i]!, val);
        }
      } catch {
        // Skip invalid chunks.
      }
    }
    return encodeRspPacket('OK');
  }

  private handleReadMemory(data: string): string {
    // Format: m<addr>,<len>
    const commaIdx = data.indexOf(',');
    if (commaIdx < 0) return encodeRspPacket('E03');

    const addrStr = data.slice(1, commaIdx);
    const lenStr = data.slice(commaIdx + 1);
    if (!addrStr || !lenStr) return encodeRspPacket('E03');

    const addr = parseInt(addrStr, 16);
    const len = parseInt(lenStr, 16);
    if (Number.isNaN(addr) || Number.isNaN(len) || len > 4096) {
      return encodeRspPacket('E03');
    }

    const session = this.config.getSession(this.config.sessionId);
    const eng = session.emulator.engine;
    const mem = eng.readMemory(addr, len);
    const hex = rleEncode(bytesToHex(mem));
    return encodeRspPacket(hex);
  }

  private handleWriteMemory(data: string): string {
    // Format: M<addr>,<len>:<hexdata>
    const commaIdx = data.indexOf(',');
    const colonIdx = data.indexOf(':');
    if (commaIdx < 0 || colonIdx < 0) return encodeRspPacket('E04');

    const addrStr = data.slice(1, commaIdx);
    const lenStr = data.slice(commaIdx + 1, colonIdx);
    const hexData = data.slice(colonIdx + 1);
    if (!addrStr || !lenStr) return encodeRspPacket('E04');

    const addr = parseInt(addrStr, 16);
    const len = parseInt(lenStr, 16);
    if (Number.isNaN(addr) || Number.isNaN(len) || len > 4096) {
      return encodeRspPacket('E04');
    }

    // Validate the payload before touching memory: exactly `len` bytes of hex.
    // Full write support requires the engine to expose writeMemory; otherwise
    // reporting OK would falsely confirm patches that were never applied.
    const session = this.config.getSession(this.config.sessionId);
    const eng = session.emulator.engine;
    return encodeRspPacket(applyGdbMemoryWrite(eng, addr, len, hexData) ? 'OK' : 'E04');
  }

  /**
   * Simulated single-step.
   *
   * Simulated execution: this increments PC by 4 and returns SIGTRAP.
   * Real instruction-level execution control requires CpuEngine.runUntilBreakpoint()
   * which is not yet exposed. GDB clients that need accurate step/continue
   * should treat this as a stub.
   */
  private handleStep(): string {
    // Simulate by advancing PC by 4 (ARM64 fixed-width instruction).
    const session = this.config.getSession(this.config.sessionId);
    try {
      const eng = session.emulator.engine;
      const pc = eng.readRegister('pc');
      // Advance PC by one instruction (ARM64 = 4 bytes).
      eng.writeRegister('pc', pc + 4);
      return encodeRspPacket('S05;thread:1;');
    } catch {
      return encodeRspPacket('E01');
    }
  }

  /**
   * Simulated continue.
   *
   * Simulated execution: writes the optional target address to PC and returns
   * SIGTRAP immediately. Real instruction-level execution control requires
   * CpuEngine.runUntilBreakpoint() which is not yet exposed. GDB clients that
   * need accurate step/continue should treat this as a stub.
   */
  private handleContinue(data: string): string {
    // c [addr] — continue from current PC or optional addr.
    const session = this.config.getSession(this.config.sessionId);
    try {
      const eng = session.emulator.engine;
      if (data.length > 1) {
        const addr = parseInt(data.slice(1), 16);
        if (!Number.isNaN(addr)) {
          eng.writeRegister('pc', addr);
        }
      }
      // Return stop reply (simulated continue — nemu doesn't support
      // unbounded execution; full execution control uses nemu_call_symbol/nemu_trace).
      return encodeRspPacket('S05;thread:1;');
    } catch {
      return encodeRspPacket('E01');
    }
  }

  private handleSetBreakpoint(data: string): string {
    // Z0,addr,kind — set software breakpoint.
    // Z1,addr,kind — set hardware breakpoint.
    // Stub: acknowledge, actual bp implementation deferred to session.
    const parts = data.split(',');
    if (parts.length < 2) return encodeRspPacket('E22');

    const bpType = parts[0]?.slice(1); // e.g. "0" from "Z0"
    const addrStr = parts[1];
    if (!addrStr) return encodeRspPacket('E22');

    const addr = parseInt(addrStr, 16);
    if (Number.isNaN(addr)) return encodeRspPacket('E22');

    // Store breakpoint in session metadata.
    const session = this.config.getSession(this.config.sessionId);
    const eng = session.emulator.engine;

    // Read original byte at address.
    try {
      const origByte = eng.readMemory(addr, 1);
      const origHex = bytesToHex(origByte);
      // Inject breakpoint instruction (BRK #0 = 0xD4200000 for ARM64, but for memory bps we use a simple flag).
      // For now, this is a tracking stub — actual breakpoint hit is checked in step/continue.
      this.emit('breakpoint-set', { type: bpType, addr, orig: origHex });
      return encodeRspPacket('OK');
    } catch {
      return encodeRspPacket('E22');
    }
  }

  private handleClearBreakpoint(data: string): string {
    // z0,addr,kind — clear software breakpoint.
    const parts = data.split(',');
    if (parts.length < 2) return encodeRspPacket('E22');
    const bpType = parts[0]?.slice(1);
    const addrStr = parts[1];
    if (!addrStr) return encodeRspPacket('E22');
    const addr = parseInt(addrStr, 16);
    if (Number.isNaN(addr)) return encodeRspPacket('E22');

    this.emit('breakpoint-cleared', { type: bpType, addr });
    return encodeRspPacket('OK');
  }

  private handleVCont(data: string): string {
    // vCont? — query supported actions.
    if (data === 'vCont?') {
      return encodeRspPacket('vCont;c;C;s;S;t');
    }

    // vCont;c[:tid] — continue
    // vCont;s[:tid] — single step
    // vCont;t[:tid] — stop

    const session = this.config.getSession(this.config.sessionId);
    const eng = session.emulator.engine;

    if (data.includes(';s')) {
      // Single step: advance PC by 4 (ARM64 fixed-width instruction).
      try {
        const pc = eng.readRegister('pc');
        eng.writeRegister('pc', pc + 4);
        return encodeRspPacket('S05;thread:1;');
      } catch {
        return encodeRspPacket('E01');
      }
    }

    if (data.includes(';c')) {
      // Continue — return stop reply.
      return encodeRspPacket('S05;thread:1;');
    }

    if (data.includes(';t')) {
      // Stop — ack with signal.
      return encodeRspPacket('S02');
    }

    return encodeRspPacket('');
  }

  private handleQXfer(data: string): string {
    // qXfer:features:read:target.xml:offset,length
    // qXfer:threads:read::offset,length
    if (data.includes('features:read:target.xml')) {
      const offsetLen = data.slice(data.lastIndexOf(':') + 1);
      const parts = offsetLen.split(',');
      const offset = parseInt(parts[0] ?? '0', 16) || 0;
      const length = parseInt(parts[1] ?? '0', 16) || 4096;

      const xml = generateTargetXml();
      const chunk = xml.slice(offset, offset + length);
      const isLast = offset + length >= xml.length;
      const prefix = isLast ? 'l' : 'm'; // l = last, m = more

      return encodeRspPacket(
        prefix +
          chunk.replace(/[^ -~]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`),
      );
    }

    if (data.includes('threads:read')) {
      const offsetLen = data.slice(data.lastIndexOf(':') + 1);
      const parts = offsetLen.split(',');
      const offset = parseInt(parts[0] ?? '0', 16) || 0;
      const length = parseInt(parts[1] ?? '0', 16) || 4096;

      const xml = generateThreadsXml();
      const chunk = xml.slice(offset, offset + length);
      const isLast = offset + length >= xml.length;

      return encodeRspPacket((isLast ? 'l' : 'm') + chunk);
    }

    return encodeRspPacket('');
  }

  private handleDetach(): string {
    // D — detach from the target. Unlike a real gdbserver (which exits on
    // detach), the listener is kept running so another client can reconnect
    // without a nemu_gdbserver start round-trip — intentional difference.
    return encodeRspPacket('OK');
  }

  private handleKill(): string {
    // k — kill request.
    // Emit event so the server owner can decide what to do.
    this.emit('kill-requested');
    return encodeRspPacket('OK');
  }
}

// ── server registry ───────────────────────────────────────────────────────

const serverRegistry = new Map<string, GdbRspServer>();

export function getOrCreateGdbServer(key: string, config: GdbServerConfig): GdbRspServer {
  let server = serverRegistry.get(key);
  if (!server) {
    server = new GdbRspServer(config);
    serverRegistry.set(key, server);
    server.on('stopped', () => {
      serverRegistry.delete(key);
    });
  }
  return server;
}

export function getGdbServer(key: string): GdbRspServer | undefined {
  return serverRegistry.get(key);
}

export function removeGdbServer(key: string): boolean {
  const server = serverRegistry.get(key);
  if (server) {
    server.stop().catch(() => {});
    serverRegistry.delete(key);
    return true;
  }
  return false;
}

export function listGdbServers(): GdbServerStatus[] {
  return Array.from(serverRegistry.values()).map((s) => s.status);
}
