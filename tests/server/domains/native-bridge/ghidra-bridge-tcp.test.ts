import { describe, it, expect, vi, beforeEach } from 'vitest';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import {
  ghidraBridgeEval,
  ghidraBridgePing,
  describeGhidraBridgeTcpError,
  GhidraBridgeTcpError,
  type GhidraBridgeTcpOptions,
} from '@server/domains/native-bridge/ghidra-bridge-tcp';

vi.mock('node:net', () => ({
  default: { connect: vi.fn() },
}));

/** Fake net.Socket collecting writes and answering with scripted frames. */
class FakeSocket extends EventEmitter {
  written: Buffer[] = [];
  destroyed = false;

  write(chunk: Buffer): boolean {
    this.written.push(chunk);
    return true;
  }
  setTimeout(): this {
    return this;
  }
  destroy(): void {
    this.destroyed = true;
    this.emit('close');
  }
  get sent(): Buffer {
    return Buffer.concat(this.written);
  }
  /** Server speaks: emit connect, then deliver raw frame bytes next tick. */
  serverResponds(payload: string): void {
    const body = Buffer.from(payload, 'utf8');
    const frame = Buffer.alloc(4 + body.length);
    frame.writeUInt32BE(body.length, 0);
    body.copy(frame, 4);
    this.emit('connect');
    setImmediate(() => this.emit('data', frame));
  }
  serverSilent(): void {
    this.emit('connect');
  }
}

let socket: FakeSocket;

function mockConnect(): void {
  vi.mocked(net.connect).mockImplementation(() => {
    socket = new FakeSocket();
    return socket as unknown as net.Socket;
  });
}

/** Read the frame our client wrote, after letting the connect promise settle. */
async function sentEnvelope(): Promise<Record<string, unknown>> {
  await new Promise((r) => setImmediate(r));
  const frame = socket.sent;
  expect(frame.length).toBeGreaterThan(4);
  expect(frame.readUInt32BE(0)).toBe(frame.length - 4);
  return JSON.parse(frame.subarray(4).toString('utf8'));
}

/**
 * Wire-protocol coverage for the pip ghidra_bridge TCP backend (kimi-cu
 * report P2-6 option (b)). Golden shapes verified against the real
 * jfx_bridge Python serializer dumps.
 */
describe('ghidra-bridge-tcp — jfx-bridge v5 wire protocol', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect();
  });

  const opts: GhidraBridgeTcpOptions = { port: 4768, timeoutMs: 2_000 };

  function respondWith(env: Record<string, unknown>, result: unknown): void {
    socket.serverResponds(JSON.stringify({ ...env, type: 'result', result }));
  }

  it('sends the golden eval envelope (base64 str keys, v5 cmd shape)', async () => {
    const pending = ghidraBridgeEval('1+1', { fn: 'main' }, opts);
    socket.serverSilent(); // connect only; we inspect the request first
    const env = await sentEnvelope();
    respondWith({ v: 5, ID: env.ID }, { type: 'int', value: '2' });
    await expect(pending).resolves.toBe(2);

    // Golden-referenced shape (fields verified against the Python serializer)
    expect(env.v).toBe(5);
    expect(typeof env.ID).toBe('string');
    expect(env.type).toBe('cmd');
    expect(env.respond).toBe(true);
    expect(env.cmd).toEqual({
      cmd: 'eval',
      args: {
        type: 'dict',
        value: [
          {
            key: { type: 'str', value: Buffer.from('expr').toString('base64') },
            value: { type: 'str', value: Buffer.from('1+1').toString('base64') },
          },
          {
            key: { type: 'str', value: Buffer.from('kwargs').toString('base64') },
            value: {
              type: 'dict',
              value: [
                {
                  key: { type: 'str', value: Buffer.from('fn').toString('base64') },
                  value: { type: 'str', value: Buffer.from('main').toString('base64') },
                },
              ],
            },
          },
        ],
      },
    });
  });

  it('decodes str / list / dict / none / bool / float / int results', async () => {
    const cases: Array<[Record<string, unknown>, unknown]> = [
      [
        { type: 'str', value: Buffer.from('decompiled text').toString('base64') },
        'decompiled text',
      ],
      [
        {
          type: 'list',
          value: [
            { type: 'str', value: Buffer.from('a').toString('base64') },
            { type: 'str', value: Buffer.from('b').toString('base64') },
          ],
        },
        ['a', 'b'],
      ],
      [{ type: 'none' }, null],
      [{ type: 'bool', value: 'True' }, true],
      [{ type: 'float', value: '1.5' }, 1.5],
      [{ type: 'int', value: '42' }, 42],
      [
        {
          type: 'dict',
          value: [
            {
              key: { type: 'str', value: Buffer.from('k').toString('base64') },
              value: { type: 'int', value: '1' },
            },
          ],
        },
        { k: 1 },
      ],
    ];
    for (const [result, expected] of cases) {
      const pending = ghidraBridgeEval('x', {}, opts);
      socket.serverSilent();
      const env = await sentEnvelope();
      respondWith({ v: 5, ID: env.ID }, result);
      await expect(pending).resolves.toEqual(expected);
    }
  });

  it('surfaces remote eval exceptions as remote errors with the decoded message', async () => {
    const pending = ghidraBridgeEval('boom()', {}, opts);
    socket.serverSilent();
    const env = await sentEnvelope();
    respondWith(
      { v: 5, ID: env.ID },
      {
        type: 'exception',
        value: { handle: 'irrelevant' },
        message: {
          type: 'str',
          value: Buffer.from("name 'boom' is not defined").toString('base64'),
        },
      },
    );

    await expect(pending).rejects.toThrow("remote eval failed: name 'boom' is not defined");
  });

  it('rejects object-handle results with an actionable unsupported error', async () => {
    const pending = ghidraBridgeEval('currentProgram', {}, opts);
    socket.serverSilent();
    const env = await sentEnvelope();
    respondWith({ v: 5, ID: env.ID }, { type: 'bridged', value: 'handle-1' });

    await expect(pending).rejects.toThrow(/plain values/);
  });

  it('rejects mismatched response IDs (protocol corruption)', async () => {
    const pending = ghidraBridgeEval('1', {}, opts);
    socket.serverResponds(
      JSON.stringify({
        v: 5,
        ID: 'not-the-request-id',
        type: 'result',
        result: { type: 'none' },
      }),
    );

    await expect(pending).rejects.toThrow(/unexpected bridge response/);
  });

  it('times out when the connected server never answers (read-phase timeout)', async () => {
    const pending = ghidraBridgeEval('slow()', {}, { port: 4768, timeoutMs: 100 });
    socket.serverSilent();
    await sentEnvelope(); // request fully written, readFrame now in flight
    socket.emit('timeout');

    await expect(pending).rejects.toThrow(/timed out after 100ms/);
    expect(socket.destroyed).toBe(true);
  });

  it('times out pre-connect when dialing a silent port (connect-phase timeout)', async () => {
    const pending = ghidraBridgeEval('1', {}, { port: 4768, timeoutMs: 100 });
    socket.emit('timeout');

    await expect(pending).rejects.toThrow(/timed out after 100ms/);
  });

  it('refuses non-loopback hosts before dialing (code-exec-as-a-service guard)', async () => {
    await expect(ghidraBridgeEval('1', {}, { host: '192.168.1.5', port: 4768 })).rejects.toThrow(
      /loopback-only/,
    );
    expect(net.connect).not.toHaveBeenCalled();
  });

  it('reports connect errors as unreachable', async () => {
    const { reachable, reason } = describeGhidraBridgeTcpError(
      new GhidraBridgeTcpError('bridge connection failed: ECONNREFUSED', 'connect'),
    );
    expect(reachable).toBe(false);
    expect(reason).toContain('ECONNREFUSED');
  });

  it('ping resolves true on a healthy eval round-trip', async () => {
    const pending = ghidraBridgePing({ port: 4768, timeoutMs: 1_000 });
    socket.serverSilent();
    const env = await sentEnvelope();
    expect(env.cmd).toMatchObject({ cmd: 'eval' });
    respondWith({ v: 5, ID: env.ID }, { type: 'bool', value: 'True' });
    await expect(pending).resolves.toBe(true);
  });
});
