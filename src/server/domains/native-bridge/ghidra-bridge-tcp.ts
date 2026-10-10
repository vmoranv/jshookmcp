/**
 * TCP client for the pip `ghidra_bridge` (justfoxing) bridge server.
 *
 * Wire protocol (jfx-bridge comms v5) — reverse-engineered from the locally
 * installed ghidra_bridge 1.0.0 / jfx_bridge 1.0.0 package and verified by
 * dumping golden envelopes through the real Python serializer:
 *
 *   frame    = 4-byte network-endian uint32 payload length + UTF-8 JSON
 *   request  = {"v":5,"ID":<uuid>,"type":"cmd","cmd":{"cmd":"eval"|"exec",
 *              "args":SER},"respond":true}
 *   response = {"v":5,"ID":<same uuid>,"type":"result","result":SER}
 *
 *   SER (serialized value) — note key names are base64-encoded too:
 *     str  = {"type":"str","value":<base64(utf8)>}
 *     int  = {"type":"int","value":"123"}
 *     float= {"type":"float","value":"1.5"}
 *     bool = {"type":"bool","value":"True"|"False"}
 *     list = {"type":"list","value":[SER...]}
 *     dict = {"type":"dict","value":[{"key":SER,"value":SER}...]}
 *     none = {"type":"none"}                       (no value field)
 *     exception = {"type":"exception","value":<handle>,"message":SER}
 *
 * The server runs `eval(expr, __main__.__dict__, kwargs)` — kwargs are the
 * expression's locals, so kwargs keys are referenced by bare name inside
 * the expression. User-supplied values travel via kwargs and never through
 * the expression string (the server is code-execution-as-a-service; the
 * expression is ours, the data is theirs).
 */

import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { logger } from '@utils/logger';
import { int } from '@src/constants';

/** Default port of the pip ghidra_bridge server (ghidra_bridge_port.py). */
export const GHIDRA_BRIDGE_TCP_PORT = int('GHIDRA_BRIDGE_TCP_PORT', 4768);

/** Eval can be slow (decompilation); the Python client defaults to x100 its 2s. */
export const GHIDRA_BRIDGE_TCP_TIMEOUT_MS = int('GHIDRA_BRIDGE_TCP_TIMEOUT_MS', 120_000);

export interface GhidraBridgeTcpOptions {
  /** Loopback only — the bridge is unencrypted code-execution-as-a-service. */
  host?: string;
  port?: number;
  timeoutMs?: number;
}

export class GhidraBridgeTcpError extends Error {
  readonly kind: 'connect' | 'timeout' | 'closed' | 'protocol' | 'remote' | 'unsupported';

  constructor(message: string, kind: GhidraBridgeTcpError['kind']) {
    super(message);
    this.name = 'GhidraBridgeTcpError';
    this.kind = kind;
  }
}

type Serialized = Record<string, unknown>;

// ── SER encoding (subset we ever need to send) ──

function serStr(value: string): Serialized {
  return { type: 'str', value: Buffer.from(value, 'utf8').toString('base64') };
}

function serValue(value: unknown): Serialized {
  if (value === null || value === undefined) return { type: 'none' };
  if (typeof value === 'boolean') return { type: 'bool', value: String(value) };
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { type: 'int', value: String(value) }
      : { type: 'float', value: String(value) };
  }
  if (typeof value === 'string') return serStr(value);
  if (Array.isArray(value)) {
    return { type: 'list', value: value.map(serValue) };
  }
  if (typeof value === 'object') {
    return {
      type: 'dict',
      value: Object.entries(value as Record<string, unknown>).map(([k, v]) => ({
        key: serValue(k),
        value: serValue(v),
      })),
    };
  }
  throw new GhidraBridgeTcpError(
    `cannot serialize ${typeof value} for the bridge wire`,
    'unsupported',
  );
}

// ── SER decoding (subset the bridge actions produce) ──

function deserValue(serial: unknown): unknown {
  if (typeof serial !== 'object' || serial === null) {
    throw new GhidraBridgeTcpError(
      `malformed serialized value: ${JSON.stringify(serial)}`,
      'protocol',
    );
  }
  const s = serial as Serialized;
  const type = s.type;
  const raw = s.value;
  switch (type) {
    case 'str':
      return Buffer.from(String(raw), 'base64').toString('utf8');
    case 'int':
      return Number.parseInt(String(raw), 10);
    case 'float':
      return Number.parseFloat(String(raw));
    case 'bool':
      return String(raw) === 'True';
    case 'none':
      return null;
    case 'list':
    case 'tuple':
      return (raw as unknown[]).map(deserValue);
    case 'dict':
      return Object.fromEntries(
        (raw as Array<{ key: unknown; value: unknown }>).map((kv) => [
          String(deserValue(kv.key)),
          deserValue(kv.value),
        ]),
      );
    case 'exception': {
      // {"type":"exception","value":<handle>,"message":SER(str)} — the Python
      // server turns eval errors into exception results; surface the message.
      const message =
        s.message === undefined ? 'unknown remote exception' : String(deserValue(s.message));
      throw new GhidraBridgeTcpError(`remote eval failed: ${message}`, 'remote');
    }
    case 'bridged':
    case 'obj':
    case 'callable_obj':
    case 'partial':
    case 'type_obj':
    case 'bytes':
      throw new GhidraBridgeTcpError(
        `bridge returned a ${String(type)} object reference — the action expression must return ` +
          'plain values (str/int/float/bool/list/dict), not remote object handles',
        'unsupported',
      );
    default:
      throw new GhidraBridgeTcpError(
        `unknown bridge wire type: ${JSON.stringify(type)}`,
        'protocol',
      );
  }
}

// ── frame I/O ──

interface FrameIo {
  writeFrame(payload: string): void;
  readFrame(): Promise<string>;
  close(): void;
}

async function connectFrameIo(host: string, port: number, timeoutMs: number): Promise<FrameIo> {
  // Loopback guard: the README is explicit that the protocol is "unencrypted
  // and unverified" and "effectively provides code execution as a service" —
  // never dial anything off-host.
  const normalized = host.toLowerCase();
  if (normalized !== '127.0.0.1' && normalized !== '::1' && normalized !== 'localhost') {
    throw new GhidraBridgeTcpError(
      `ghidra_bridge TCP backend is loopback-only (got ${host})`,
      'unsupported',
    );
  }

  return await new Promise<FrameIo>((resolve, reject) => {
    const socket = net.connect({ host, port });
    // In-flight read waiter — set after connect, consulted by both the
    // data/close handlers and the post-connect timeout path.
    let pending: { resolve: (frame: string) => void; reject: (e: Error) => void } | undefined;
    let connected = false;
    let closed = false;

    const timeoutError = (): GhidraBridgeTcpError =>
      new GhidraBridgeTcpError(`bridge response timed out after ${timeoutMs}ms`, 'timeout');

    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => {
      // Connect phase: nothing settled yet — reject the io promise.
      if (!connected) {
        socket.destroy();
        reject(timeoutError());
        return;
      }
      // Read phase: the server accepted the request but never answered.
      if (pending) {
        const waiter = pending;
        pending = undefined;
        waiter.reject(timeoutError());
      }
      socket.destroy();
    });
    socket.on('error', (err) => {
      if (!connected) {
        socket.destroy();
        reject(new GhidraBridgeTcpError(`bridge connection failed: ${err.message}`, 'connect'));
        return;
      }
      if (pending) {
        const waiter = pending;
        pending = undefined;
        waiter.reject(
          new GhidraBridgeTcpError(`bridge connection failed: ${err.message}`, 'connect'),
        );
      }
      socket.destroy();
    });

    socket.on('connect', () => {
      connected = true;
      const chunks: Buffer[] = [];
      let buffered = Buffer.alloc(0);

      const tryDeliver = (): void => {
        while (pending) {
          if (buffered.length < 4) return;
          const size = buffered.readUInt32BE(0);
          if (buffered.length < 4 + size) return;
          const payload = buffered
            .subarray(4, 4 + size)
            .toString('utf8')
            .trim();
          buffered = buffered.subarray(4 + size);
          const waiter = pending;
          pending = undefined;
          waiter.resolve(payload);
        }
      };

      socket.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        buffered = Buffer.concat(chunks);
        chunks.length = 0;
        tryDeliver();
      });
      socket.on('close', () => {
        closed = true;
        if (pending) {
          const waiter = pending;
          pending = undefined;
          waiter.reject(
            new GhidraBridgeTcpError('bridge closed the connection mid-request', 'closed'),
          );
        }
      });

      resolve({
        writeFrame(payload: string): void {
          if (closed) {
            throw new GhidraBridgeTcpError('bridge connection is closed', 'closed');
          }
          const body = Buffer.from(payload, 'utf8');
          const frame = Buffer.alloc(4 + body.length);
          frame.writeUInt32BE(body.length, 0);
          body.copy(frame, 4);
          socket.write(frame);
        },
        readFrame(): Promise<string> {
          if (closed) {
            return Promise.reject(
              new GhidraBridgeTcpError('bridge connection is closed', 'closed'),
            );
          }
          // One in-flight request per connection — no response-manager needed.
          if (pending) {
            return Promise.reject(
              new GhidraBridgeTcpError(
                'concurrent reads on a single bridge connection',
                'protocol',
              ),
            );
          }
          return new Promise<string>((res, rej) => {
            pending = { resolve: res, reject: rej };
            tryDeliver();
          });
        },
        close(): void {
          socket.destroy();
        },
      });
    });
  });
}

async function bridgeCommand(
  command: 'eval' | 'exec',
  expr: string,
  kwargs: Record<string, unknown>,
  options: GhidraBridgeTcpOptions,
): Promise<unknown> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? GHIDRA_BRIDGE_TCP_PORT;
  const timeoutMs = options.timeoutMs ?? GHIDRA_BRIDGE_TCP_TIMEOUT_MS;

  const id = randomUUID();
  // Golden-referenced shape: cmd.args is the serialized {expr, kwargs} dict —
  // key names are base64 strings like every other str on this wire.
  const envelope = {
    v: 5,
    ID: id,
    type: 'cmd',
    cmd: {
      cmd: command,
      args: serValue({ expr, kwargs }),
    },
    respond: true,
  };

  const io = await connectFrameIo(host, port, timeoutMs);
  try {
    io.writeFrame(JSON.stringify(envelope));
    const raw = await io.readFrame();
    const response = JSON.parse(raw) as { ID?: unknown; type?: unknown; result?: unknown };
    if (response.ID !== id || response.type !== 'result') {
      throw new GhidraBridgeTcpError(
        `unexpected bridge response (want result for ${id}, got ${JSON.stringify(response).slice(0, 200)})`,
        'protocol',
      );
    }
    return deserValue(response.result);
  } finally {
    io.close();
  }
}

/**
 * Evaluate a Python expression inside the bridge server's __main__ context
 * (Ghidra flat API). `kwargs` become the expression's locals — reference them
 * by bare name. Returns plain values only (str/int/float/bool/list/dict).
 */
export async function ghidraBridgeEval(
  expr: string,
  kwargs: Record<string, unknown> = {},
  options: GhidraBridgeTcpOptions = {},
): Promise<unknown> {
  return bridgeCommand('eval', expr, kwargs, options);
}

/**
 * Execute Python statements in the bridge server's __main__ context. exec has
 * no return value on this wire (result is none); chain an eval for results.
 */
export async function ghidraBridgeExec(
  code: string,
  kwargs: Record<string, unknown> = {},
  options: GhidraBridgeTcpOptions = {},
): Promise<void> {
  await bridgeCommand('exec', code, kwargs, options);
}

/** Connectivity probe: the cheapest round-trip the protocol allows. */
export async function ghidraBridgePing(options: GhidraBridgeTcpOptions = {}): Promise<boolean> {
  const result = await ghidraBridgeEval('True', {}, options);
  return result === true;
}

export function describeGhidraBridgeTcpError(error: unknown): {
  reachable: boolean;
  reason: string;
} {
  if (!(error instanceof GhidraBridgeTcpError)) {
    return { reachable: false, reason: error instanceof Error ? error.message : String(error) };
  }
  return {
    reachable: error.kind !== 'connect' && error.kind !== 'timeout' && error.kind !== 'closed',
    reason: error.message,
  };
}

export function logGhidraBridgeTcpWarning(scope: string, error: unknown): void {
  const { reason } = describeGhidraBridgeTcpError(error);
  logger.warn(`[native-bridge] ghidra_bridge TCP ${scope} failed`, { reason });
}
