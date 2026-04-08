import { describe, expect, it, beforeEach, vi } from 'vitest';
import { MojoMonitor, buildMojoFridaScript } from '@modules/mojo-ipc/MojoMonitor';
import type {
  MojoMonitorConfig,
  MojoMessage,
  FridaMojoScriptConfig,
} from '@modules/mojo-ipc/types';

describe('buildMojoFridaScript', () => {
  it('generates a non-empty script string', () => {
    const config: FridaMojoScriptConfig = {
      hooks: ['EnqueueMessage', 'DispatchMessage'],
      interfaceFilters: [],
      maxMessages: 10000,
    };
    const script = buildMojoFridaScript(config);
    expect(typeof script).toBe('string');
    expect(script.length).toBeGreaterThan(100);
    expect(script).toContain('mojoMessages');
    expect(script).toContain('rpc.exports');
  });

  it('includes interface filters in the generated script', () => {
    const config: FridaMojoScriptConfig = {
      hooks: ['EnqueueMessage'],
      interfaceFilters: ['network.mojom'],
      maxMessages: 5000,
    };
    const script = buildMojoFridaScript(config);
    expect(script).toContain('network.mojom');
  });

  it('respects maxMessages config in the generated script', () => {
    const config: FridaMojoScriptConfig = {
      hooks: [],
      interfaceFilters: [],
      maxMessages: 500,
    };
    const script = buildMojoFridaScript(config);
    expect(script).toContain('500');
  });

  it('includes rpc exports for getMessages, clearMessages, messageCount', () => {
    const config: FridaMojoScriptConfig = {
      hooks: [],
      interfaceFilters: [],
      maxMessages: 100,
    };
    const script = buildMojoFridaScript(config);
    expect(script).toContain('getMessages');
    expect(script).toContain('clearMessages');
    expect(script).toContain('messageCount');
  });
});

describe('MojoMonitor', () => {
  let monitor: MojoMonitor;

  beforeEach(() => {
    monitor = new MojoMonitor();
  });

  describe('hasFrida', () => {
    it('returns false when no frida bridge is provided', () => {
      expect(monitor.hasFrida()).toBe(false);
    });

    it('returns false when frida bridge is null', () => {
      const m = new MojoMonitor({ fridaBridge: null as unknown as undefined });
      expect(m.hasFrida()).toBe(false);
    });

    it('returns true when frida bridge is provided', () => {
      const m = new MojoMonitor({ fridaBridge: {} });
      expect(m.hasFrida()).toBe(true);
    });
  });

  describe('startMonitor (no frida)', () => {
    it('starts a session and returns a sessionId', async () => {
      const config: MojoMonitorConfig = {
        pid: 1234,
        processName: 'chrome',
      };
      const sessionId = await monitor.startMonitor(config);
      expect(typeof sessionId).toBe('string');
      expect(sessionId).toMatch(/^mojo_[a-f0-9]+$/);
    });

    it('starts a session with default config when no args given', async () => {
      const config: MojoMonitorConfig = {};
      const sessionId = await monitor.startMonitor(config);
      expect(sessionId).toMatch(/^mojo_[a-f0-9]+$/);
    });

    it('starts a session with interface filters', async () => {
      const config: MojoMonitorConfig = {
        interfaces: ['network.mojom.*'],
      };
      const sessionId = await monitor.startMonitor(config);
      expect(sessionId).toMatch(/^mojo_[a-f0-9]+$/);
    });
  });

  describe('getMessages', () => {
    it('returns empty array for a new session', async () => {
      const sessionId = await monitor.startMonitor({});
      const messages = await monitor.getMessages(sessionId);
      expect(messages).toEqual([]);
    });

    it('returns empty array for unknown sessionId', async () => {
      const messages = await monitor.getMessages('mojo_unknown');
      expect(messages).toEqual([]);
    });

    it('filters messages by substring', async () => {
      const sessionId = await monitor.startMonitor({});
      // Manually add messages to the monitor's internal store
      const m = monitor as unknown as {
        store: {
          addMessage: (sessionId: string, msg: MojoMessage) => void;
        };
      };
      m.store.addMessage(sessionId, {
        interface: 'network.mojom.NetworkService',
        method: 'CreateLoaderAndStart',
        pipe: 'pipe1',
        timestamp: new Date().toISOString(),
        payload: '00010002',
      });
      m.store.addMessage(sessionId, {
        interface: 'url.mojom.Url',
        method: 'Resolve',
        pipe: 'pipe2',
        timestamp: new Date().toISOString(),
        payload: '00010003',
      });

      const filtered = await monitor.getMessages(sessionId, 'network');
      expect(filtered.length).toBe(1);
      expect(filtered[0]).toBeDefined();
      expect(filtered[0]!.interface).toBe('network.mojom.NetworkService');

      const allMessages = await monitor.getMessages(sessionId);
      expect(allMessages.length).toBe(2);
    });

    it('respects maxBuffer config', async () => {
      const config: MojoMonitorConfig = { maxBuffer: 2 };
      const sessionId = await monitor.startMonitor(config);

      const m = monitor as unknown as {
        store: {
          addMessage: (sessionId: string, msg: MojoMessage) => void;
        };
      };

      for (let i = 0; i < 5; i++) {
        m.store.addMessage(sessionId, {
          interface: 'test',
          method: 'method',
          pipe: `pipe${i}`,
          timestamp: new Date().toISOString(),
          payload: '00',
        });
      }

      const messages = await monitor.getMessages(sessionId);
      expect(messages.length).toBe(2);
      expect(messages[0]!.pipe).toBe('pipe3');
      expect(messages[1]!.pipe).toBe('pipe4');
    });
  });

  describe('stopMonitor', () => {
    it('returns message count and removes session', async () => {
      const sessionId = await monitor.startMonitor({});
      const m = monitor as unknown as {
        store: {
          addMessage: (sessionId: string, msg: MojoMessage) => void;
        };
      };
      m.store.addMessage(sessionId, {
        interface: 'test',
        method: 'm',
        pipe: 'p1',
        timestamp: new Date().toISOString(),
        payload: '00',
      });
      m.store.addMessage(sessionId, {
        interface: 'test',
        method: 'm',
        pipe: 'p2',
        timestamp: new Date().toISOString(),
        payload: '00',
      });

      const count = await monitor.stopMonitor(sessionId);
      expect(count).toBe(2);

      // Session should be gone
      const messages = await monitor.getMessages(sessionId);
      expect(messages).toEqual([]);
    });

    it('returns 0 for unknown session', async () => {
      const count = await monitor.stopMonitor('mojo_unknown');
      expect(count).toBe(0);
    });
  });

  describe('listSessions', () => {
    it('returns empty list when no sessions', async () => {
      const sessions = await monitor.listSessions();
      expect(sessions).toEqual([]);
    });

    it('lists active sessions', async () => {
      const id1 = await monitor.startMonitor({ pid: 123 });
      const id2 = await monitor.startMonitor({ pid: 456 });

      const sessions = await monitor.listSessions();
      expect(sessions.length).toBe(2);

      const ids = sessions.map((s) => s.id);
      expect(ids).toContain(id1);
      expect(ids).toContain(id2);
    });

    it('shows correct messageCount', async () => {
      const sessionId = await monitor.startMonitor({});
      const m = monitor as unknown as {
        store: {
          addMessage: (sessionId: string, msg: MojoMessage) => void;
        };
      };
      m.store.addMessage(sessionId, {
        interface: 'test',
        method: 'm',
        pipe: 'p',
        timestamp: new Date().toISOString(),
        payload: '00',
      });

      const sessions = await monitor.listSessions();
      const session = sessions.find((s) => s.id === sessionId);
      expect(session).toBeDefined();
      expect(session?.messageCount).toBe(1);
    });
  });

  describe('setFridaBridge', () => {
    it('can set a frida bridge after construction', () => {
      const m = new MojoMonitor();
      expect(m.hasFrida()).toBe(false);
      m.setFridaBridge({});
      expect(m.hasFrida()).toBe(true);
    });

    it('can clear a frida bridge', () => {
      const m = new MojoMonitor({ fridaBridge: {} });
      expect(m.hasFrida()).toBe(true);
      m.setFridaBridge(null);
      expect(m.hasFrida()).toBe(false);
    });
  });

  describe('startMonitor (with frida)', () => {
    it('uses frida bridge when available', async () => {
      const mockBridge = {
        attach: vi.fn().mockResolvedValue(undefined),
        inject: vi.fn().mockResolvedValue(undefined),
      };
      const m = new MojoMonitor({ fridaBridge: mockBridge });

      const sessionId = await m.startMonitor({
        pid: 1234,
        processName: 'chrome',
      });

      expect(sessionId).toMatch(/^mojo_[a-f0-9]+$/);
      expect(mockBridge.attach).toHaveBeenCalledWith(1234, 'chrome');
      expect(mockBridge.inject).toHaveBeenCalled();
    });

    it('gracefully degrades when frida attachment fails', async () => {
      const mockBridge = {
        attach: vi.fn().mockRejectedValue(new Error('connection refused')),
        inject: vi.fn().mockResolvedValue(undefined),
      };
      const m = new MojoMonitor({ fridaBridge: mockBridge });

      // Should not throw
      const sessionId = await m.startMonitor({ pid: 1234 });
      expect(sessionId).toMatch(/^mojo_[a-f0-9]+$/);
    });

    it('does not call attach when bridge.attach is not a function', async () => {
      const mockBridge = {};
      const m = new MojoMonitor({ fridaBridge: mockBridge });

      const sessionId = await m.startMonitor({ pid: 1234 });
      expect(sessionId).toMatch(/^mojo_[a-f0-9]+$/);
    });
  });
});
