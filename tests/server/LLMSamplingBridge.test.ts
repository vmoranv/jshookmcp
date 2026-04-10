import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LLMSamplingBridge } from '@server/LLMSamplingBridge';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

function createMockServer(capabilities?: { sampling?: object }): McpServer {
  return {
    server: {
      getClientCapabilities: vi.fn(() => capabilities ?? {}),
      createMessage: vi.fn(),
    },
  } as unknown as McpServer;
}

describe('LLMSamplingBridge', () => {
  let mockServer: McpServer;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isSamplingSupported', () => {
    it('returns true when client declares sampling capability', () => {
      mockServer = createMockServer({ sampling: {} });
      const bridge = new LLMSamplingBridge(mockServer);
      expect(bridge.isSamplingSupported()).toBe(true);
    });

    it('returns false when client has no sampling capability', () => {
      mockServer = createMockServer({});
      const bridge = new LLMSamplingBridge(mockServer);
      expect(bridge.isSamplingSupported()).toBe(false);
    });

    it('returns false when getClientCapabilities throws', () => {
      mockServer = {
        server: {
          getClientCapabilities: vi.fn(() => {
            throw new Error('not connected');
          }),
        },
      } as unknown as McpServer;
      const bridge = new LLMSamplingBridge(mockServer);
      expect(bridge.isSamplingSupported()).toBe(false);
    });
  });

  describe('sampleText', () => {
    it('returns null when sampling is not supported', async () => {
      mockServer = createMockServer({});
      const bridge = new LLMSamplingBridge(mockServer);
      const result = await bridge.sampleText({
        systemPrompt: 'test',
        userMessage: 'hello',
      });
      expect(result).toBeNull();
      expect(mockServer.server.createMessage).not.toHaveBeenCalled();
    });

    it('sends createMessage and extracts text from array content', async () => {
      mockServer = createMockServer({ sampling: {} });
      (mockServer.server.createMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: [
          { type: 'text', text: 'Hello ' },
          { type: 'text', text: 'World' },
        ],
      });

      const bridge = new LLMSamplingBridge(mockServer);
      const result = await bridge.sampleText({
        systemPrompt: 'You are a helper.',
        userMessage: 'Say hello',
        maxTokens: 100,
      });

      expect(result).toBe('Hello World');
      expect(mockServer.server.createMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            {
              role: 'user',
              content: { type: 'text', text: 'Say hello' },
            },
          ],
          systemPrompt: 'You are a helper.',
          maxTokens: 100,
        }),
      );
    });

    it('extracts text from single content block', async () => {
      mockServer = createMockServer({ sampling: {} });
      (mockServer.server.createMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: { type: 'text', text: 'Single response' },
      });

      const bridge = new LLMSamplingBridge(mockServer);
      const result = await bridge.sampleText({
        systemPrompt: 'test',
        userMessage: 'test',
      });
      expect(result).toBe('Single response');
    });

    it('returns null when createMessage fails', async () => {
      mockServer = createMockServer({ sampling: {} });
      (mockServer.server.createMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Connection lost'),
      );

      const bridge = new LLMSamplingBridge(mockServer);
      const result = await bridge.sampleText({
        systemPrompt: 'test',
        userMessage: 'test',
      });
      expect(result).toBeNull();
    });

    it('passes modelPreferences when modelHint is provided', async () => {
      mockServer = createMockServer({ sampling: {} });
      (mockServer.server.createMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
      });

      const bridge = new LLMSamplingBridge(mockServer);
      await bridge.sampleText({
        systemPrompt: 'test',
        userMessage: 'test',
        modelHint: 'haiku',
      });

      expect(mockServer.server.createMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          modelPreferences: expect.objectContaining({
            hints: [{ name: 'haiku' }],
          }),
        }),
      );
    });

    it('defaults to 512 maxTokens when not specified', async () => {
      mockServer = createMockServer({ sampling: {} });
      (mockServer.server.createMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
      });

      const bridge = new LLMSamplingBridge(mockServer);
      await bridge.sampleText({
        systemPrompt: 'test',
        userMessage: 'test',
      });

      expect(mockServer.server.createMessage).toHaveBeenCalledWith(
        expect.objectContaining({ maxTokens: 512 }),
      );
    });
  });
});
