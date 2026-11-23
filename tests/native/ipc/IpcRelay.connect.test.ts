/**
 * IpcRelay — connection lifecycle over a mocked node:net socket.
 *
 * Covers the in-flight connect guard, intentional-close suppression, and
 * rejecting pending requests when an unexpected close arrives.
 */

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const netMock = vi.hoisted(() => ({
  createConnection: vi.fn(),
}));

vi.mock('node:net', () => ({
  default: { createConnection: netMock.createConnection },
  createConnection: netMock.createConnection,
}));

import { IpcRelay } from '@native/ipc/IpcRelay';

class FakeSocket extends EventEmitter {
  write = vi.fn(() => true);
  destroy = vi.fn(() => {
    this.emit('close');
  });
  connectCb: (() => void) | null = null;
}

let sockets: FakeSocket[];

function makeSocket(_path: string, cb?: () => void): FakeSocket {
  const s = new FakeSocket();
  s.connectCb = cb ?? null;
  sockets.push(s);
  return s;
}

describe('IpcRelay connection lifecycle', () => {
  let relay: IpcRelay;

  beforeEach(() => {
    sockets = [];
    netMock.createConnection.mockReset();
    netMock.createConnection.mockImplementation(makeSocket);
    relay = new IpcRelay({ sessionId: 'lifecycle-test', path: '/tmp/x.sock' });
  });

  afterEach(() => {
    relay.disconnect();
    vi.useRealTimers();
  });

  it('shares one in-flight connect across concurrent requests', async () => {
    const p1 = relay.connect();
    const p2 = relay.connect();
    await vi.waitFor(() => expect(netMock.createConnection).toHaveBeenCalledTimes(1));

    sockets[0]!.connectCb?.();
    await Promise.all([p1, p2]);
    expect(relay.status.connected).toBe(true);
  });

  it('does not reconnect or double-emit after an intentional disconnect', async () => {
    const p = relay.connect();
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    sockets[0]!.connectCb?.();
    await p;

    let disconnected = 0;
    relay.on('disconnected', () => disconnected++);

    relay.disconnect();
    expect(disconnected).toBe(1);

    // The close event that destroy() emits must be ignored.
    sockets[0]!.emit('close');
    expect(disconnected).toBe(1);
    expect(relay.status.connected).toBe(false);
  });

  it('rejects in-flight requests when an unexpected close arrives', async () => {
    const p = relay.connect();
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    sockets[0]!.connectCb?.();
    await p;

    const pending = relay.request('nemu.read_memory', {});
    expect(sockets[0]!.write).toHaveBeenCalledTimes(1);

    sockets[0]!.emit('close');
    await expect(pending).rejects.toThrow(/Connection closed before response/);
  });
});
