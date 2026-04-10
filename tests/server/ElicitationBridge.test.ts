import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ElicitationBridge } from '@server/ElicitationBridge';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

function createMockServer(capabilities?: { elicitation?: object }): McpServer {
  return {
    server: {
      getClientCapabilities: vi.fn(() => capabilities ?? {}),
      elicitInput: vi.fn(),
    },
  } as unknown as McpServer;
}

describe('ElicitationBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isElicitationSupported', () => {
    it('returns true when client declares elicitation capability', () => {
      const server = createMockServer({ elicitation: {} });
      const bridge = new ElicitationBridge(server);
      expect(bridge.isElicitationSupported()).toBe(true);
    });

    it('returns false when client has no elicitation capability', () => {
      const server = createMockServer({});
      const bridge = new ElicitationBridge(server);
      expect(bridge.isElicitationSupported()).toBe(false);
    });

    it('returns false when getClientCapabilities throws', () => {
      const server = {
        server: {
          getClientCapabilities: vi.fn(() => {
            throw new Error('not connected');
          }),
        },
      } as unknown as McpServer;
      const bridge = new ElicitationBridge(server);
      expect(bridge.isElicitationSupported()).toBe(false);
    });
  });

  describe('requestFormInput', () => {
    it('returns null when elicitation is not supported', async () => {
      const server = createMockServer({});
      const bridge = new ElicitationBridge(server);

      const result = await bridge.requestFormInput({
        message: 'test',
        requestedSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Your name' },
          },
        },
      });

      expect(result).toBeNull();
      expect(server.server.elicitInput).not.toHaveBeenCalled();
    });

    it('returns accept result with content', async () => {
      const server = createMockServer({ elicitation: {} });
      (server.server.elicitInput as ReturnType<typeof vi.fn>).mockResolvedValue({
        action: 'accept',
        content: { name: 'Alice' },
      });

      const bridge = new ElicitationBridge(server);
      const result = await bridge.requestFormInput({
        message: 'Enter your name',
        requestedSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Your name' },
          },
          required: ['name'],
        },
      });

      expect(result).toEqual({
        action: 'accept',
        content: { name: 'Alice' },
      });
    });

    it('returns decline result', async () => {
      const server = createMockServer({ elicitation: {} });
      (server.server.elicitInput as ReturnType<typeof vi.fn>).mockResolvedValue({
        action: 'decline',
      });

      const bridge = new ElicitationBridge(server);
      const result = await bridge.requestFormInput({
        message: 'Do you agree?',
        requestedSchema: {
          type: 'object',
          properties: {
            agree: { type: 'boolean', title: 'Agree' },
          },
        },
      });

      expect(result?.action).toBe('decline');
    });

    it('returns null when elicitInput throws', async () => {
      const server = createMockServer({ elicitation: {} });
      (server.server.elicitInput as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Connection lost'),
      );

      const bridge = new ElicitationBridge(server);
      const result = await bridge.requestFormInput({
        message: 'test',
        requestedSchema: {
          type: 'object',
          properties: { q: { type: 'string' } },
        },
      });

      expect(result).toBeNull();
    });
  });

  describe('requestConfirmation', () => {
    it('returns true when user accepts and confirms', async () => {
      const server = createMockServer({ elicitation: {} });
      (server.server.elicitInput as ReturnType<typeof vi.fn>).mockResolvedValue({
        action: 'accept',
        content: { confirmed: true },
      });

      const bridge = new ElicitationBridge(server);
      const result = await bridge.requestConfirmation('Are you sure?');
      expect(result).toBe(true);
    });

    it('returns false when user declines', async () => {
      const server = createMockServer({ elicitation: {} });
      (server.server.elicitInput as ReturnType<typeof vi.fn>).mockResolvedValue({
        action: 'decline',
      });

      const bridge = new ElicitationBridge(server);
      const result = await bridge.requestConfirmation('Are you sure?');
      expect(result).toBe(false);
    });

    it('returns false when elicitation not supported', async () => {
      const server = createMockServer({});
      const bridge = new ElicitationBridge(server);
      const result = await bridge.requestConfirmation('Are you sure?');
      expect(result).toBe(false);
    });
  });

  describe('requestCaptchaSolution', () => {
    it('returns solved result with token', async () => {
      const server = createMockServer({ elicitation: {} });
      (server.server.elicitInput as ReturnType<typeof vi.fn>).mockResolvedValue({
        action: 'accept',
        content: { solved: true, token: 'captcha-token-123' },
      });

      const bridge = new ElicitationBridge(server);
      const result = await bridge.requestCaptchaSolution('https://example.com/login', 'reCAPTCHA');

      expect(result).toEqual({
        solved: true,
        token: 'captcha-token-123',
      });
    });

    it('returns solved without token', async () => {
      const server = createMockServer({ elicitation: {} });
      (server.server.elicitInput as ReturnType<typeof vi.fn>).mockResolvedValue({
        action: 'accept',
        content: { solved: true },
      });

      const bridge = new ElicitationBridge(server);
      const result = await bridge.requestCaptchaSolution('https://example.com', 'Cloudflare');

      expect(result).toEqual({ solved: true, token: undefined });
    });

    it('returns null when user dismisses', async () => {
      const server = createMockServer({ elicitation: {} });
      (server.server.elicitInput as ReturnType<typeof vi.fn>).mockResolvedValue({
        action: 'dismiss',
      });

      const bridge = new ElicitationBridge(server);
      const result = await bridge.requestCaptchaSolution('https://example.com', 'hCaptcha');
      expect(result).toBeNull();
    });

    it('returns null when elicitation not supported', async () => {
      const server = createMockServer({});
      const bridge = new ElicitationBridge(server);
      const result = await bridge.requestCaptchaSolution('https://example.com', 'reCAPTCHA');
      expect(result).toBeNull();
    });
  });
});
