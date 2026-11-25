/**
 * Cross-platform IPC Relay for native-emulator sessions.
 *
 * Allows an ARM64 nemu session running on a Linux/macOS host to be
 * driven from a Windows MCP server (or vice versa) via JSON-RPC 2.0
 * over length-prefixed frames.
 *
 * Transport selection by platform:
 *   Windows     → named pipe: \\.\pipe\jshookmcp_emu_{sessionId}
 *   Linux/macOS → Unix domain socket: /tmp/jshookmcp_emu_{sessionId}.sock
 *   TCP fallback → tcp://host:port (configurable, for remote hosts)
 *
 * Wire format (same as CE MCP Bridge):
 *   [4 bytes: payload length, LE uint32] [N bytes: UTF-8 JSON-RPC 2.0]
 *
 * Safety:
 *   - Connection timeout: 5s default
 *   - Max message size: 1 MiB
 *   - Auth token support for remote TCP connections
 *   - Auto-reconnect with exponential backoff (1s → 2s → 4s → ... → 30s cap)
 *
 * @module ipc/IpcRelay
 */

import type { Socket } from 'node:net';
import { EventEmitter } from 'node:events';

// ── constants ───────────────────────────────────────────────────────────

const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_MESSAGE_BYTES = 1 * 1024 * 1024; // 1 MiB
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

export interface IpcRelayConfig {
  sessionId: string;
  /** Override the transport path (full named pipe / socket / host:port). */
  path?: string;
  /** TCP fallback host (default: '127.0.0.1'). */
  host?: string;
  /** TCP fallback port (default: 17171). */
  port?: number;
  /** Auth token for remote connections, sent as JSON-RPC 'auth' param. */
  authToken?: string;
  /** Connection timeout in ms (default: 5000). */
  connectTimeoutMs?: number;
  /** Max inbound message bytes (default: 1 MiB). */
  maxMessageBytes?: number;
}

export interface IpcRelayStatus {
  sessionId: string;
  connected: boolean;
  transport: string;
  path: string;
  bytesSent: number;
  bytesReceived: number;
  messagesSent: number;
  messagesReceived: number;
  reconnectAttempts: number;
  lastError?: string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ── relay ───────────────────────────────────────────────────────────────

export class IpcRelay extends EventEmitter {
  private config: IpcRelayConfig;
  private socket: Socket | null = null;
  private receiveBuffer = Buffer.alloc(0);
  private pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private connected = false;
  private bytesSent = 0;
  private bytesReceived = 0;
  private messagesSent = 0;
  private messagesReceived = 0;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastError: string | undefined;
  /** In-flight connect, shared so parallel requests open one socket. */
  private connecting: Promise<void> | null = null;
  /** True while an explicit disconnect() is tearing the relay down. */
  private intentionalClose = false;

  constructor(config: IpcRelayConfig) {
    super();
    this.config = {
      host: '127.0.0.1',
      connectTimeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
      maxMessageBytes: DEFAULT_MAX_MESSAGE_BYTES,
      ...config,
    };
  }

  // ── public ──────────────────────────────────────────────────────────────

  get status(): IpcRelayStatus {
    return {
      sessionId: this.config.sessionId,
      connected: this.connected,
      transport: process.platform === 'win32' ? 'named-pipe' : 'unix-socket',
      path: this.resolvePath(),
      bytesSent: this.bytesSent,
      bytesReceived: this.bytesReceived,
      messagesSent: this.messagesSent,
      messagesReceived: this.messagesReceived,
      reconnectAttempts: this.reconnectAttempts,
      lastError: this.lastError,
    };
  }

  /** Connect to the relay endpoint. Resolves when connected or rejects on timeout. */
  async connect(): Promise<void> {
    if (this.connected) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.doConnect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async doConnect(): Promise<void> {
    this.intentionalClose = false;
    const { default: net } = await import('node:net');
    const path = this.resolvePath();
    const connectTimeout = this.config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.socket?.destroy();
        this.lastError = `Connection to ${path} timed out after ${connectTimeout}ms`;
        reject(new Error(this.lastError));
      }, connectTimeout);

      const sock = net.createConnection(path, () => {
        clearTimeout(timer);
        this.connected = true;
        this.reconnectAttempts = 0;
        this.lastError = undefined;
        this.emit('connected', { path });
        resolve();
      });

      sock.on('data', (chunk: Buffer) => this.handleData(chunk));
      sock.on('close', () => this.handleClose(sock));
      sock.on('error', (err: Error) => {
        clearTimeout(timer);
        this.lastError = err.message;
        if (!this.connected) {
          reject(err);
        }
      });

      this.socket = sock;
    });
  }

  /** Disconnect and cancel pending requests. */
  disconnect(): void {
    this.intentionalClose = true;
    this.cancelReconnect();

    // Reject all pending requests.
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Disconnected'));
      this.pending.delete(id);
    }

    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
    this.receiveBuffer = Buffer.alloc(0);
    this.emit('disconnected');
  }

  /**
   * Send a JSON-RPC request and wait for the response.
   *
   * @param method — e.g. 'nemu.read_memory', 'nemu.call_symbol'
   * @param params — method-specific parameters
   * @param timeoutMs — per-request timeout (default: 30s)
   */
  async request(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 30000,
  ): Promise<unknown> {
    if (!this.connected) {
      await this.connect();
    }

    const id = this.nextId++;
    const frame = this.buildFrame(id, method, params);

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request ${method} (id=${id}) timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      try {
        this.socket!.write(frame);
        this.bytesSent += frame.length;
        this.messagesSent++;
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * Send a JSON-RPC notification (no response expected).
   */
  notify(method: string, params: Record<string, unknown> = {}): void {
    const frame = this.buildFrame(0, method, params); // id=0 for notifications
    if (this.socket && this.connected) {
      try {
        this.socket.write(frame);
        this.bytesSent += frame.length;
        this.messagesSent++;
      } catch {
        this.lastError = `Failed to send notification '${method}'`;
      }
    }
  }

  // ── private ─────────────────────────────────────────────────────────────

  private resolvePath(): string {
    const SAFE_SESSION_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
    if (!SAFE_SESSION_ID.test(this.config.sessionId)) {
      throw new Error(
        `Invalid sessionId: "${this.config.sessionId}". Must match ${SAFE_SESSION_ID}`,
      );
    }

    if (this.config.path) return this.config.path;

    if (process.platform === 'win32') {
      return `\\\\.\\pipe\\jshookmcp_emu_${this.config.sessionId}`;
    }
    return `/tmp/jshookmcp_emu_${this.config.sessionId}.sock`;
  }

  private buildFrame(id: number, method: string, params: Record<string, unknown>): Buffer {
    const msg: Record<string, unknown> = {
      jsonrpc: '2.0',
      method,
      params,
      id,
    };
    if (this.config.authToken) {
      (msg as Record<string, unknown>).auth = this.config.authToken;
      if (
        this.config.host &&
        this.config.host !== '127.0.0.1' &&
        this.config.host !== 'localhost'
      ) {
        console.warn(
          `[IpcRelay] authToken sent in plaintext to ${this.config.host}. Use TLS tunnel.`,
        );
      }
    }
    const json = JSON.stringify(msg);
    const payload = Buffer.from(json, 'utf8');
    const frame = Buffer.alloc(4 + payload.length);
    frame.writeUInt32LE(payload.length, 0);
    payload.copy(frame, 4);
    return frame;
  }

  private handleData(chunk: Buffer): void {
    this.bytesReceived += chunk.length;

    const MAX_BUFFER = (this.config.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES) * 2;
    if (this.receiveBuffer.length + chunk.length > MAX_BUFFER) {
      this.lastError = `Receive buffer exceeded ${MAX_BUFFER} bytes`;
      this.socket?.destroy();
      return;
    }

    this.receiveBuffer = Buffer.concat([this.receiveBuffer, chunk]);

    while (this.receiveBuffer.length >= 4) {
      const msgLen = this.receiveBuffer.readUInt32LE(0);
      const maxLen = this.config.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;

      if (msgLen > maxLen) {
        this.lastError = `Message size ${msgLen} exceeds max ${maxLen} bytes — discarding`;
        this.receiveBuffer = Buffer.alloc(0);
        return;
      }

      if (this.receiveBuffer.length < 4 + msgLen) {
        // Incomplete frame — wait for more data.
        return;
      }

      const payload = this.receiveBuffer.subarray(4, 4 + msgLen);
      this.receiveBuffer = this.receiveBuffer.subarray(4 + msgLen);
      this.messagesReceived++;

      try {
        const json = JSON.parse(payload.toString('utf8'));
        this.dispatchResponse(json);
      } catch (err) {
        this.lastError = `Failed to parse inbound JSON-RPC: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
  }

  private dispatchResponse(msg: Record<string, unknown>): void {
    const id = typeof msg.id === 'number' ? msg.id : 0;
    const pending = this.pending.get(id);

    if (!pending) {
      // Unsolicited response or notification — emit as event.
      this.emit('message', msg);
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(id);

    if (msg.error) {
      const errObj = msg.error as Record<string, unknown>;
      pending.reject(
        new Error(`JSON-RPC error ${errObj.code ?? '?'}: ${errObj.message ?? 'unknown error'}`),
      );
    } else {
      pending.resolve(msg.result);
    }
  }

  private handleClose(sock?: Socket): void {
    // A close from a superseded socket must not tear down a newer connection.
    if (sock && this.socket !== null && this.socket !== sock) return;

    this.connected = false;
    this.socket = null;
    this.receiveBuffer = Buffer.alloc(0);

    if (this.intentionalClose) {
      // disconnect() already emitted and rejected pending requests.
      return;
    }

    // Fail outstanding requests immediately rather than letting them wait for
    // their full timeout on a dead connection.
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Connection closed before response'));
      this.pending.delete(id);
    }

    this.emit('disconnected');

    // Auto-reconnect with exponential backoff.
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.cancelReconnect();
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts),
      RECONNECT_MAX_MS,
    );
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(() => {
        // connect() already sets lastError — next handleClose will
        // re-trigger scheduleReconnect for further attempts.
      });
    }, delay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

/** Active relay connections keyed by sessionId. */
const relayRegistry = new Map<string, IpcRelay>();

export function getOrCreateRelay(config: IpcRelayConfig): IpcRelay {
  let relay = relayRegistry.get(config.sessionId);
  if (!relay) {
    relay = new IpcRelay(config);
    relayRegistry.set(config.sessionId, relay);
    relay.on('disconnected', () => {
      // Keep the relay instance in the registry so the caller can reconnect.
    });
  }
  return relay;
}

export function removeRelay(sessionId: string): boolean {
  const relay = relayRegistry.get(sessionId);
  if (relay) {
    relay.disconnect();
    relayRegistry.delete(sessionId);
    return true;
  }
  return false;
}

export function getRelayStatus(sessionId: string): IpcRelayStatus | null {
  const relay = relayRegistry.get(sessionId);
  return relay ? relay.status : null;
}

export function listRelays(): IpcRelayStatus[] {
  return Array.from(relayRegistry.values()).map((r) => r.status);
}
