import { describe, expect, it, beforeEach } from 'vitest';
import { MojoIPCHandlers } from '@server/domains/mojo-ipc/handlers/impl';

describe('MojoIPCHandlers', () => {
  let handlers: MojoIPCHandlers;

  beforeEach(() => {
    handlers = new MojoIPCHandlers();
  });

  // ── mojo_monitor_start ──

  describe('mojo_monitor_start', () => {
    it('starts a session and returns a text response', async () => {
      const result = (await handlers.handleStart({
        pid: 1234,
        processName: 'chrome',
      })) as { content: Array<{ type: string; text: string }> };

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const payload = JSON.parse(result.content[0].text);
      expect(payload.sessionId).toMatch(/^mojo_[a-f0-9]+$/);
      expect(payload.status).toBe('started');
      expect(payload.config.pid).toBe(1234);
      expect(payload.config.maxBuffer).toBe(10000);
      expect(payload.hasFrida).toBe(false);
    });

    it('uses default maxBuffer when not provided', async () => {
      const result = (await handlers.handleStart({})) as {
        content: Array<{ type: string; text: string }>;
      };
      const payload = JSON.parse(result.content[0].text);
      expect(payload.config.maxBuffer).toBe(10000);
    });

    it('accepts custom maxBuffer', async () => {
      const result = (await handlers.handleStart({
        maxBuffer: 500,
      })) as { content: Array<{ type: string; text: string }> };
      const payload = JSON.parse(result.content[0].text);
      expect(payload.config.maxBuffer).toBe(500);
    });

    it('accepts interface filters', async () => {
      const result = (await handlers.handleStart({
        interfaces: ['network.mojom'],
      })) as { content: Array<{ type: string; text: string }> };
      const payload = JSON.parse(result.content[0].text);
      expect(payload.config.interfaceFilter).toEqual(['network.mojom']);
    });

    it('shows auto-detect when pid not provided', async () => {
      const result = (await handlers.handleStart({})) as {
        content: Array<{ type: string; text: string }>;
      };
      const payload = JSON.parse(result.content[0].text);
      expect(payload.config.pid).toBe('auto-detect');
    });
  });

  // ── mojo_monitor_stop ──

  describe('mojo_monitor_stop', () => {
    it('throws when sessionId is missing', async () => {
      await expect(handlers.handleStop({})).rejects.toThrow('sessionId is required');
    });

    it('throws when sessionId is empty string', async () => {
      await expect(handlers.handleStop({ sessionId: '' })).rejects.toThrow('sessionId is required');
    });

    it('stops a session and returns message count', async () => {
      const startResult = (await handlers.handleStart({})) as {
        content: Array<{ type: string; text: string }>;
      };
      const startPayload = JSON.parse(startResult.content[0].text);

      const result = (await handlers.handleStop({
        sessionId: startPayload.sessionId,
      })) as { content: Array<{ type: string; text: string }> };

      const payload = JSON.parse(result.content[0].text);
      expect(payload.sessionId).toBe(startPayload.sessionId);
      expect(payload.status).toBe('stopped');
      expect(payload.messageCount).toBe(0);
    });

    it('returns 0 for unknown session', async () => {
      const result = (await handlers.handleStop({
        sessionId: 'mojo_unknown',
      })) as { content: Array<{ type: string; text: string }> };
      const payload = JSON.parse(result.content[0].text);
      expect(payload.messageCount).toBe(0);
    });
  });

  // ── mojo_messages_get ──

  describe('mojo_messages_get', () => {
    it('throws when sessionId is missing', async () => {
      await expect(handlers.handleGetMessages({})).rejects.toThrow('sessionId is required');
    });

    it('returns empty messages for a new session', async () => {
      const startResult = (await handlers.handleStart({})) as {
        content: Array<{ type: string; text: string }>;
      };
      const startPayload = JSON.parse(startResult.content[0].text);

      const result = (await handlers.handleGetMessages({
        sessionId: startPayload.sessionId,
      })) as { content: Array<{ type: string; text: string }> };
      const payload = JSON.parse(result.content[0].text);

      expect(payload.sessionId).toBe(startPayload.sessionId);
      expect(payload.messageCount).toBe(0);
      expect(payload.messages).toEqual([]);
      expect(payload.filter).toBe('none');
    });

    it('supports filter parameter', async () => {
      const startResult = (await handlers.handleStart({})) as {
        content: Array<{ type: string; text: string }>;
      };
      const startPayload = JSON.parse(startResult.content[0].text);

      // Manually add a message via the monitor
      const monitorHandler = handlers.getMonitorHandler();
      const monitor = monitorHandler.getMonitor();
      const store = (
        monitor as unknown as {
          store: {
            addMessage: (
              sessionId: string,
              msg: import('@modules/mojo-ipc/types').MojoMessage,
            ) => void;
          };
        }
      ).store;
      store.addMessage(startPayload.sessionId, {
        interface: 'network.mojom.NetworkService',
        method: 'CreateLoaderAndStart',
        pipe: 'pipe1',
        timestamp: new Date().toISOString(),
        payload: '0001',
      });

      const result = (await handlers.handleGetMessages({
        sessionId: startPayload.sessionId,
        filter: 'network',
      })) as { content: Array<{ type: string; text: string }> };
      const payload = JSON.parse(result.content[0].text);

      expect(payload.messageCount).toBe(1);
      expect(payload.filter).toBe('network');
    });

    it('returns empty for unknown session', async () => {
      const result = (await handlers.handleGetMessages({
        sessionId: 'mojo_nonexistent',
      })) as { content: Array<{ type: string; text: string }> };
      const payload = JSON.parse(result.content[0].text);
      expect(payload.messageCount).toBe(0);
    });
  });

  // ── mojo_decode_message ──

  describe('mojo_decode_message', () => {
    it('throws when messageHex is missing', async () => {
      await expect(handlers.handleDecode({ interfaceName: 'test' })).rejects.toThrow(
        'messageHex is required',
      );
    });

    it('throws when interfaceName is missing', async () => {
      await expect(handlers.handleDecode({ messageHex: '0001' })).rejects.toThrow(
        'interfaceName is required',
      );
    });

    it('decodes a message and returns structured result', async () => {
      const result = (await handlers.handleDecode({
        messageHex: '000100020000000300000000',
        interfaceName: 'network.mojom.NetworkService',
      })) as { content: Array<{ type: string; text: string }> };

      expect(result.content).toHaveLength(1);
      const payload = JSON.parse(result.content[0].text);
      expect(payload.interface).toBe('network.mojom.NetworkService');
      expect(payload.rawHex).toBe('000100020000000300000000');
      expect(payload.parameters).toBeDefined();
    });

    it('resolves known interface methods by ordinal', async () => {
      const result = (await handlers.handleDecode({
        messageHex: '000100000000000000000000',
        interfaceName: 'network.mojom.URLLoader',
      })) as { content: Array<{ type: string; text: string }> };

      const payload = JSON.parse(result.content[0].text);
      // Method ordinal 0 for URLLoader should be 'FollowRedirect'
      expect(payload.method).toBe('FollowRedirect');
    });
  });

  // ── mojo_interfaces_list ──

  describe('mojo_interfaces_list', () => {
    it('lists all known interfaces when no filter', async () => {
      const result = (await handlers.handleListInterfaces({})) as {
        content: Array<{ type: string; text: string }>;
      };
      const payload = JSON.parse(result.content[0].text);
      expect(payload.count).toBeGreaterThan(0);
      expect(payload.filter).toBe('none');
      expect(Array.isArray(payload.interfaces)).toBe(true);
    });

    it('filters interfaces by name', async () => {
      const result = (await handlers.handleListInterfaces({
        filter: 'network',
      })) as { content: Array<{ type: string; text: string }> };
      const payload = JSON.parse(result.content[0].text);
      expect(payload.count).toBeGreaterThan(0);
      for (const iface of payload.interfaces) {
        expect(iface.name.toLowerCase()).toContain('network');
      }
    });

    it('returns count 0 for unknown filter', async () => {
      const result = (await handlers.handleListInterfaces({
        filter: 'xyz_nonexistent_interface_name',
      })) as { content: Array<{ type: string; text: string }> };
      const payload = JSON.parse(result.content[0].text);
      expect(payload.count).toBe(0);
    });
  });

  // ── accessors ──

  describe('accessors', () => {
    it('getMonitorHandler returns the monitor handler', () => {
      const mh = handlers.getMonitorHandler();
      expect(mh).toBeDefined();
      expect(typeof mh.handleStart).toBe('function');
    });

    it('getDecodeHandler returns the decode handler', () => {
      const dh = handlers.getDecodeHandler();
      expect(dh).toBeDefined();
      expect(typeof dh.handleDecode).toBe('function');
    });
  });
});
