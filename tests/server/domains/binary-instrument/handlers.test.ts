import { describe, expect, it } from 'vitest';
import { BinaryInstrumentHandlers } from '@server/domains/binary-instrument/handlers';
import type { MCPServerContext } from '@server/MCPServer.context';

describe('BinaryInstrumentHandlers', () => {
  function createMockContext(): MCPServerContext {
    return {
      extensionPluginsById: new Map(),
      extensionPluginRuntimeById: new Map(),
    } as unknown as MCPServerContext;
  }

  function createHandlers(): BinaryInstrumentHandlers {
    return new BinaryInstrumentHandlers(createMockContext());
  }

  describe('Frida proxy handlers', () => {
    it('handleFridaAttach returns error when plugin not installed', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleFridaAttach({ pid: '1234' });

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      expect(text).toContain('not installed');
    });

    it('handleFridaRunScript returns error when sessionId missing', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleFridaRunScript({});

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      expect(text).toContain('Missing required string argument');
    });

    it('handleFridaDetach returns error when sessionId missing', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleFridaDetach({});

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      expect(text).toContain('Missing required string argument');
    });

    it('handleFridaListSessions returns error when plugin not installed', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleFridaListSessions({});

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      expect(text).toContain('not installed');
    });

    it('handleFridaGenerateScript returns error when plugin not installed', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleFridaGenerateScript({ template: 'trace' });

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      expect(text).toContain('not installed');
    });

    it('handleGetAvailablePlugins returns empty list when no plugins', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleGetAvailablePlugins({});

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(text);
      expect(parsed.plugins).toEqual([]);
      expect(parsed.count).toBe(0);
    });
  });

  describe('Static analysis handlers', () => {
    it('handleGhidraAnalyze returns error when plugin not installed', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleGhidraAnalyze({ targetPath: '/path/to/binary' });

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      expect(text).toContain('not installed');
    });

    it('handleGhidraDecompile returns error when plugin not installed', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleGhidraDecompile({ functionName: 'main' });

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      expect(text).toContain('not installed');
    });

    it('handleIdaDecompile returns error when plugin not installed', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleIdaDecompile({ targetPath: '/path/to/binary' });

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      expect(text).toContain('not installed');
    });

    it('handleJadxDecompile returns error when plugin not installed', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleJadxDecompile({ targetPath: '/path/to/app.apk' });

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      expect(text).toContain('not installed');
    });
  });

  describe('Unidbg handlers', () => {
    it('handleUnidbgLaunch returns error when soPath missing', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleUnidbgLaunch({});

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      expect(text).toContain('Missing required string argument');
    });

    it('handleUnidbgCall returns error when sessionId missing', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleUnidbgCall({});

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      expect(text).toContain('Missing required string argument');
    });

    it('handleUnidbgCall returns error when session not found', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleUnidbgCall({
        sessionId: 'nonexistent',
        functionName: 'test',
      });

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      expect(text).toContain('not found');
    });

    it('handleUnidbgTrace returns error when sessionId missing', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleUnidbgTrace({});

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      expect(text).toContain('Missing required string argument');
    });

    it('handleUnidbgTrace returns error when session not found', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleUnidbgTrace({ sessionId: 'nonexistent' });

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      expect(text).toContain('not found');
    });
  });

  describe('Hook generation handlers', () => {
    it('handleGenerateHooks returns error when ghidraOutput missing', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleGenerateHooks({});

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      expect(text).toContain('ghidraOutput is required');
    });

    it('handleGenerateHooks returns error for invalid JSON', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleGenerateHooks({ ghidraOutput: 'not-json' });

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      expect(text).toContain('Invalid JSON');
    });

    it('handleGenerateHooks processes valid Ghidra output', async () => {
      const handlers = createHandlers();
      const ghidraOutput = JSON.stringify({
        functions: [
          {
            name: 'Java_com_example_test',
            address: '0x1000',
            signature: 'void()',
            returnType: 'void',
            parameters: [],
          },
        ],
        callGraph: [],
        strings: [],
        imports: [],
        decompilations: [],
      });

      const result = await handlers.handleGenerateHooks({ ghidraOutput });

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(text);
      expect(parsed.count).toBe(1);
      expect(parsed.hooks[0].functionName).toBe('Java_com_example_test');
    });

    it('handleExportHookScript returns default script when no templates', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleExportHookScript({});

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(text);
      expect(parsed.script).toContain('Java.perform');
      expect(parsed.format).toBe('frida');
    });

    it('handleExportHookScript exports provided templates', async () => {
      const handlers = createHandlers();
      const templates = JSON.stringify([
        {
          functionName: 'test_func',
          hookCode: 'console.log("test");',
          description: 'Test hook',
          parameters: [],
        },
      ]);

      const result = await handlers.handleExportHookScript({ hookTemplates: templates });

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(text);
      expect(parsed.script).toContain('console.log("test")');
      expect(parsed.hookCount).toBe(1);
    });

    it('handleExportHookScript returns error for invalid JSON', async () => {
      const handlers = createHandlers();
      const result = await handlers.handleExportHookScript({ hookTemplates: 'not-json' });

      const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      expect(text).toContain('Invalid JSON');
    });
  });
});
