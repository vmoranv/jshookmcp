/**
 * GdbRspServer — lifecycle + registry tests.
 *
 * Full protocol correctness is covered by GdbRspProtocol.test.ts (40 tests).
 * TCP smoke tests are unreliable on Windows due to ephemeral port exhaustion
 * in the Vitest fork-pool test runner.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GdbRspServer,
  applyGdbMemoryWrite,
  getOrCreateGdbServer,
  removeGdbServer,
  listGdbServers,
} from '@native/GdbRspServer';
import type { GdbEmulatorEngine } from '@native/GdbRspServer.types';
import type { EmulatorSession } from '@modules/native-emulator/SessionManager';

function createMockSession(): EmulatorSession {
  return {
    id: 'test-session',
    emulator: {} as unknown as EmulatorSession['emulator'],
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
  };
}

let mockSession: EmulatorSession;

beforeEach(() => {
  mockSession = createMockSession();
});
afterEach(async () => {
  removeGdbServer('test-session');
  removeGdbServer('test-key');
  removeGdbServer('test-remove');
  await new Promise((r) => setTimeout(r, 50));
});

describe('GdbRspServer lifecycle', () => {
  it('starts and stops a TCP server', async () => {
    const srv = new GdbRspServer({
      host: '127.0.0.1',
      port: 0,
      sessionId: 'test-session',
      getSession: () => mockSession,
    });
    expect(srv.running).toBe(false);
    await srv.start();
    expect(srv.running).toBe(true);
    expect(srv.status.running).toBe(true);
    expect(srv.status.clients).toHaveLength(0);
    await srv.stop();
    expect(srv.running).toBe(false);
  });

  it('does not double-start', async () => {
    const srv = new GdbRspServer({
      host: '127.0.0.1',
      port: 0,
      sessionId: 'test-session',
      getSession: () => mockSession,
    });
    await srv.start();
    await srv.start();
    expect(srv.running).toBe(true);
    await srv.stop();
  });

  it('status reports server info when running', async () => {
    const srv = new GdbRspServer({
      host: '127.0.0.1',
      port: 0,
      sessionId: 'test-session',
      getSession: () => mockSession,
    });
    await srv.start();
    const s = srv.status;
    expect(s.running).toBe(true);
    expect(s.host).toBe('127.0.0.1');
    expect(s.sessionId).toBe('test-session');
    expect(s.totalConnections).toBeGreaterThanOrEqual(0);
    await srv.stop();
  });

  it('reports bound port (not 0) when started on port 0', async () => {
    const srv = new GdbRspServer({
      host: '127.0.0.1',
      port: 0,
      sessionId: 'test-session',
      getSession: () => mockSession,
    });
    await srv.start();
    expect(srv.status.port).toBeGreaterThan(0);
    await srv.stop();
  });
});

describe('getOrCreateGdbServer / removeGdbServer / listGdbServers', () => {
  it('getOrCreate returns same instance', () => {
    const a = getOrCreateGdbServer('test-key', {
      host: '127.0.0.1',
      port: 0,
      sessionId: 'test-key',
      getSession: () => mockSession,
    });
    const b = getOrCreateGdbServer('test-key', {
      host: '127.0.0.1',
      port: 9999,
      sessionId: 'test-key',
      getSession: () => mockSession,
    });
    expect(a).toBe(b);
  });

  it('listGdbServers returns array', () => {
    expect(Array.isArray(listGdbServers())).toBe(true);
  });

  it('removeGdbServer returns true for known key, false for unknown', () => {
    getOrCreateGdbServer('test-remove', {
      host: '127.0.0.1',
      port: 0,
      sessionId: 'test-remove',
      getSession: () => mockSession,
    });
    expect(removeGdbServer('test-remove')).toBe(true);
    expect(removeGdbServer('test-remove')).toBe(false);
  });
});

describe('applyGdbMemoryWrite (RSP M packet)', () => {
  const baseEngine: GdbEmulatorEngine = {
    readRegister: () => 0,
    writeRegister: () => {},
    readMemory: () => new Uint8Array(0),
  };

  it('applies validated hex through an engine that supports writes', () => {
    const writes: Array<{ address: number; bytes: Uint8Array }> = [];
    const engine: GdbEmulatorEngine = {
      ...baseEngine,
      writeMemory(address, bytes) {
        writes.push({ address, bytes });
      },
    };

    expect(applyGdbMemoryWrite(engine, 0x1000, 2, 'cafe')).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.address).toBe(0x1000);
    expect([...writes[0]!.bytes]).toEqual([0xca, 0xfe]);
  });

  it('rejects writes when the engine has no writeMemory surface', () => {
    // The old handler answered OK after a read-only probe and silently
    // discarded hexData.
    expect(applyGdbMemoryWrite(baseEngine, 0x1000, 1, 'cc')).toBe(false);
  });

  it('rejects length mismatches and non-hex payloads', () => {
    const engine: GdbEmulatorEngine = { ...baseEngine, writeMemory: () => {} };
    expect(applyGdbMemoryWrite(engine, 0x1000, 2, 'cc')).toBe(false); // short
    expect(applyGdbMemoryWrite(engine, 0x1000, 1, 'zz')).toBe(false); // non-hex
  });
});
