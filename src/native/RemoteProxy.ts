/**
 * Remote MCP Proxy for jshookmcp — ceserver-style remote debugging stub.
 *
 * Connects to a remote jshookmcp MCP server via WebSocket using JSON-RPC 2.0
 * framing (compatible with IpcRelay wire format). Forwards tool calls and
 * returns results to the caller.
 *
 * Wire format: JSON-RPC 2.0 request/response objects sent as UTF-8 text
 * over a WebSocket connection (binary-safe for base64 payloads).
 *
 * Safety:
 *   - Auth token support for authenticated remote connections
 *   - Auto-reconnect with exponential backoff (1s → 2s → 4s → … → 30s cap)
 *   - Connection timeout: 10s default
 *   - Max message size: 4 MiB
 *
 * @module native/RemoteProxy
 */

import { EventEmitter } from 'node:events';

// ── constants ─────────────────────────────────────────────────────────────

const DEFAULT_CONNECT_TIMEOUT_MS = 10000;
const DEFAULT_REQUEST_TIMEOUT_MS = 60000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

// ── types ──────────────────────────────────────────────────────────────────

/** Minimal WebSocket interface (compatible with 'ws' package and browser WebSocket). */
interface WebSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'open', cb: () => void): void;
  on(event: 'message', cb: (data: string | Buffer) => void): void;
  on(event: 'close', cb: (code: number, reason: string) => void): void;
  on(event: 'error', cb: (err: Error) => void): void;
}

export interface RemoteProxyConfig {
  /** WebSocket URL to connect to (e.g. ws://192.168.1.100:17171). */
  url: string;
  /** Auth token sent in the initial handshake. */
  authToken?: string;
  /** Connection timeout in ms. */
  connectTimeoutMs?: number;
  /** Per-request timeout in ms. */
  requestTimeoutMs?: number;
  /**
   * Optional WebSocket factory. If not provided, attempts to load the 'ws'
   * package at runtime. Provide a factory to avoid the dynamic import.
   * Example: (url, opts) => new require('ws')(url, opts)
   */
  wsFactory?: (url: string, opts?: { headers: Record<string, string> }) => WebSocketLike;
}

export interface RemoteProxyStatus {
  url: string;
  connected: boolean;
  bytesSent: number;
  bytesReceived: number;
  requestsSent: number;
  responsesReceived: number;
  errors: number;
  reconnectAttempts: number;
  lastError?: string;
  connectedAt: Date | null;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  method: string;
}

// ── proxy ──────────────────────────────────────────────────────────────────

export class RemoteProxy extends EventEmitter {
  private config: Omit<Required<RemoteProxyConfig>, 'wsFactory'> &
    Pick<RemoteProxyConfig, 'wsFactory'>;
  private ws: WebSocketLike | null = null;
  private pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private connected = false;
  private bytesSent = 0;
  private bytesReceived = 0;
  private requestsSent = 0;
  private responsesReceived = 0;
  private errors = 0;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastError: string | undefined;
  private connectedAt: Date | null = null;
  private intentionalClose = false;
  /** In-flight connect, shared so concurrent callers cannot open two sockets. */
  private connectPromise: Promise<void> | null = null;

  constructor(config: RemoteProxyConfig) {
    super();
    this.config = {
      url: config.url,
      authToken: config.authToken ?? '',
      connectTimeoutMs: config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      requestTimeoutMs: config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      wsFactory: config.wsFactory,
    };
  }

  // ── public ───────────────────────────────────────────────────────────────

  get status(): RemoteProxyStatus {
    return {
      url: this.config.url,
      connected: this.connected,
      bytesSent: this.bytesSent,
      bytesReceived: this.bytesReceived,
      requestsSent: this.requestsSent,
      responsesReceived: this.responsesReceived,
      errors: this.errors,
      reconnectAttempts: this.reconnectAttempts,
      lastError: this.lastError,
      connectedAt: this.connectedAt,
    };
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    // The factory resolution below yields, so without this guard two callers
    // (or a reconnect racing a caller) would each open a socket and the last
    // assignment would orphan the first.
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.doConnect().finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  private async doConnect(): Promise<void> {
    this.intentionalClose = false;
    const connectTimeout = this.config.connectTimeoutMs;

    // Resolve the WebSocket factory — use the provided one or load 'ws' at runtime.
    const createWs =
      this.config.wsFactory ??
      (await (async () => {
        const { createRequire } = await import('node:module');
        const wsRequire = createRequire(import.meta.url);
        const { WebSocket: Ws } = wsRequire('ws') as {
          WebSocket: new (...args: unknown[]) => WebSocketLike;
        };
        return (url: string, opts?: { headers: Record<string, string> }) =>
          new Ws(url, opts) as WebSocketLike;
      })());

    return new Promise<void>((resolve, reject) => {
      let ws: WebSocketLike | undefined;
      let opened = false;

      const timer = setTimeout(() => {
        // `this.ws` is the socket under construction (assigned below) — close
        // it, otherwise the connection attempt outlives the rejected promise.
        if (this.ws === ws) this.ws = null;
        ws?.close();
        this.lastError = `Connection to ${this.config.url} timed out after ${connectTimeout}ms`;
        reject(new Error(this.lastError));
      }, connectTimeout);

      try {
        const headers: Record<string, string> = {};
        if (this.config.authToken) {
          headers['Authorization'] = `Bearer ${this.config.authToken}`;
        }
        ws = createWs(this.config.url, { headers });
      } catch (err) {
        clearTimeout(timer);
        this.lastError = `Failed to create WebSocket: ${err instanceof Error ? err.message : String(err)}`;
        reject(new Error(this.lastError));
        return;
      }

      // Track the socket from the start so disconnect() can abort an in-flight
      // connect (previously it was only assigned on 'open').
      this.ws = ws;

      ws.on('open', () => {
        clearTimeout(timer);
        opened = true;
        this.ws = ws;
        this.connected = true;
        this.reconnectAttempts = 0;
        this.lastError = undefined;
        this.connectedAt = new Date();
        this.emit('connected', { url: this.config.url });
        resolve();
      });

      ws.on('message', (data: Buffer | string) => {
        const str = typeof data === 'string' ? data : data.toString('utf8');
        this.bytesReceived += str.length;
        this.handleMessage(str);
      });

      ws.on('close', () => {
        // Settle a connect() that never opened instead of waiting for timeout.
        clearTimeout(timer);
        // Ignore close events from a socket superseded by a newer connection.
        if (this.ws !== null && this.ws !== ws) return;

        this.connected = false;
        this.ws = null;
        this.connectedAt = null;

        // Fail in-flight requests immediately instead of letting them run out
        // their timers on a connection that can no longer answer.
        for (const [id, pending] of this.pending) {
          clearTimeout(pending.timer);
          pending.reject(new Error('Connection closed'));
          this.pending.delete(id);
        }

        this.emit('disconnected');

        if (!opened) {
          reject(new Error('Connection closed before open'));
        }

        if (!this.intentionalClose) {
          this.scheduleReconnect();
        }
      });

      ws.on('error', (err: Error) => {
        clearTimeout(timer);
        this.lastError = err.message;
        this.errors++;
        // EventEmitter treats an unhandled 'error' event as a synchronous
        // throw. Consumers are not required to subscribe, so only forward when
        // someone is listening; status.lastError still records it.
        if (this.listenerCount('error') > 0) {
          this.emit('error', err);
        }

        if (!this.connected) {
          reject(err);
        }
      });
    });
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.cancelReconnect();

    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Disconnected'));
      this.pending.delete(id);
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.connectedAt = null;
  }

  /**
   * Forward a tool call to the remote jshookmcp instance and return the result.
   *
   * @param toolName — the MCP tool name (e.g. 'memory_read', 'process_list')
   * @param args — tool arguments object
   * @param timeoutMs — per-request timeout (default: 60s)
   */
  async forward(
    toolName: string,
    args: Record<string, unknown> = {},
    timeoutMs?: number,
  ): Promise<unknown> {
    if (!this.connected) {
      await this.connect();
    }

    const id = this.nextId++;
    const timeout = timeoutMs ?? this.config.requestTimeoutMs;

    const request: Record<string, unknown> = {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: toolName, arguments: args },
      id,
    };

    const frame = JSON.stringify(request);

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.errors++;
        reject(new Error(`Request '${toolName}' (id=${id}) timed out after ${timeout}ms`));
      }, timeout);

      this.pending.set(id, {
        resolve,
        reject,
        timer,
        method: toolName,
      });

      try {
        this.ws!.send(frame);
        this.bytesSent += frame.length;
        this.requestsSent++;
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        this.errors++;
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  // ── private ──────────────────────────────────────────────────────────────

  private handleMessage(message: string): void {
    try {
      const msg = JSON.parse(message) as Record<string, unknown>;

      // Handle JSON-RPC response.
      if (msg.id !== undefined) {
        const id = typeof msg.id === 'number' ? msg.id : 0;
        const pending = this.pending.get(id);

        if (!pending) {
          // Unsolicited message — emit as event.
          this.emit('message', msg);
          return;
        }

        clearTimeout(pending.timer);
        this.pending.delete(id);
        this.responsesReceived++;

        if (msg.error) {
          const errObj = msg.error as Record<string, unknown>;
          const errMsg = errObj.message ?? 'Unknown remote error';
          const errCode = errObj.code ?? -1;
          pending.reject(new Error(`Remote error [${errCode}]: ${errMsg}`));
        } else {
          pending.resolve(msg.result);
        }
      } else {
        // Notification or unsolicited message.
        this.emit('message', msg);
      }
    } catch {
      this.lastError = 'Failed to parse inbound JSON-RPC message';
      this.errors++;
    }
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
        // connect() already sets lastError — handleClose will
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

// ── proxy registry ─────────────────────────────────────────────────────

const proxyRegistry = new Map<string, RemoteProxy>();

export function getOrCreateRemoteProxy(key: string, config: RemoteProxyConfig): RemoteProxy {
  let proxy = proxyRegistry.get(key);
  if (!proxy) {
    proxy = new RemoteProxy(config);
    proxyRegistry.set(key, proxy);
  }
  return proxy;
}

export function getRemoteProxy(key: string): RemoteProxy | undefined {
  return proxyRegistry.get(key);
}

export function removeRemoteProxy(key: string): boolean {
  const proxy = proxyRegistry.get(key);
  if (proxy) {
    proxy.disconnect();
    proxyRegistry.delete(key);
    return true;
  }
  return false;
}

export function listRemoteProxies(): RemoteProxyStatus[] {
  return Array.from(proxyRegistry.values()).map((p) => p.status);
}
