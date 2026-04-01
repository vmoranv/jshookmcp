import { parseJson } from '@tests/server/domains/shared/mock-factories';
import type { BrowserStatusResponse } from '@tests/shared/common-test-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@src/constants', () => ({
  SCRIPTS_MAX_CAP: 500,
}));

import { ScriptManagementHandlers } from '@server/domains/browser/handlers/script-management';

interface GetAllScriptsResponse {
  count: number;
  scripts: Array<{ scriptId: string; url?: string }>;
}

interface GetScriptSourceResponse {
  success: boolean;
  message?: string;
  scriptId?: string;
  url?: string;
  preview?: boolean;
  totalLines?: number;
  size?: number;
  sizeKB?: string;
  showingLines?: string;
  content?: string;
  hint?: string;
  detailId?: string;
  truncated?: boolean;
  source?: string;
}

describe('ScriptManagementHandlers — comprehensive coverage', () => {
  const scriptManager = {
    getAllScripts: vi.fn(),
    getScriptSource: vi.fn(),
  };
  const detailedDataManager = {
    smartHandle: vi.fn(),
  };

  let handlers: ScriptManagementHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new ScriptManagementHandlers({
      scriptManager: scriptManager as any,
      detailedDataManager: detailedDataManager as any,
    });
  });

  describe('handleGetAllScripts', () => {
    it('uses default includeSource=false and maxScripts=1000 when includeSource is false', async () => {
      const scripts = [{ scriptId: '1' }, { scriptId: '2' }];
      scriptManager.getAllScripts.mockResolvedValue(scripts);
      detailedDataManager.smartHandle.mockReturnValue({ count: 2, scripts });

      await handlers.handleGetAllScripts({});

      expect(scriptManager.getAllScripts).toHaveBeenCalledWith(false, 500);
    });

    it('uses maxScripts=200 when includeSource is true', async () => {
      const scripts = [{ scriptId: '1' }];
      scriptManager.getAllScripts.mockResolvedValue(scripts);
      detailedDataManager.smartHandle.mockReturnValue({ count: 1, scripts });

      await handlers.handleGetAllScripts({ includeSource: true });

      expect(scriptManager.getAllScripts).toHaveBeenCalledWith(true, 200);
    });

    it('respects custom maxScripts value', async () => {
      const scripts = [];
      scriptManager.getAllScripts.mockResolvedValue(scripts);
      detailedDataManager.smartHandle.mockReturnValue({ count: 0, scripts });

      await handlers.handleGetAllScripts({ maxScripts: 50 });

      expect(scriptManager.getAllScripts).toHaveBeenCalledWith(false, 50);
    });

    it('caps maxScripts at SCRIPTS_MAX_CAP', async () => {
      const scripts = [];
      scriptManager.getAllScripts.mockResolvedValue(scripts);
      detailedDataManager.smartHandle.mockReturnValue({ count: 0, scripts });

      await handlers.handleGetAllScripts({ maxScripts: 10000 });

      // Should be capped at 500 (SCRIPTS_MAX_CAP)
      expect(scriptManager.getAllScripts).toHaveBeenCalledWith(false, 500);
    });

    it('uses includeSource maxScripts when includeSource=true and no custom maxScripts', async () => {
      scriptManager.getAllScripts.mockResolvedValue([]);
      detailedDataManager.smartHandle.mockReturnValue({ count: 0, scripts: [] });

      await handlers.handleGetAllScripts({ includeSource: true });

      expect(scriptManager.getAllScripts).toHaveBeenCalledWith(true, 200);
    });

    it('caps includeSource maxScripts at SCRIPTS_MAX_CAP when custom value exceeds', async () => {
      scriptManager.getAllScripts.mockResolvedValue([]);
      detailedDataManager.smartHandle.mockReturnValue({ count: 0, scripts: [] });

      await handlers.handleGetAllScripts({ includeSource: true, maxScripts: 600 });

      expect(scriptManager.getAllScripts).toHaveBeenCalledWith(true, 500);
    });

    it('wraps result with smartHandle', async () => {
      const scripts = [{ scriptId: 'script-1' }];
      scriptManager.getAllScripts.mockResolvedValue(scripts);
      detailedDataManager.smartHandle.mockReturnValue({ processed: true });

      const body = parseJson<BrowserStatusResponse>(await handlers.handleGetAllScripts({}));

      expect(detailedDataManager.smartHandle).toHaveBeenCalledWith({
        count: 1,
        scripts,
      });
      expect(body.processed).toBe(true);
    });

    it('returns empty array when no scripts exist', async () => {
      scriptManager.getAllScripts.mockResolvedValue([]);
      detailedDataManager.smartHandle.mockImplementation((v) => v);

      const body = parseJson<GetAllScriptsResponse>(await handlers.handleGetAllScripts({}));

      expect(body.count).toBe(0);
      expect(body.scripts).toEqual([]);
    });

    it('returns multiple scripts with correct count', async () => {
      const scripts = [
        { scriptId: '1', url: 'https://example.com/a.js' },
        { scriptId: '2', url: 'https://example.com/b.js' },
        { scriptId: '3', url: 'https://example.com/c.js' },
      ];
      scriptManager.getAllScripts.mockResolvedValue(scripts);
      detailedDataManager.smartHandle.mockImplementation((v) => v);

      const body = parseJson<GetAllScriptsResponse>(await handlers.handleGetAllScripts({}));

      expect(body.count).toBe(3);
      expect(body.scripts).toHaveLength(3);
    });
  });

  describe('handleGetScriptSource', () => {
    describe('script not found', () => {
      it('returns not found when script is null', async () => {
        scriptManager.getScriptSource.mockResolvedValue(null);

        const body = parseJson<GetScriptSourceResponse>(
          await handlers.handleGetScriptSource({ scriptId: 'missing' }),
        );

        expect(body.success).toBe(false);
        expect(body.message).toBe('Script not found');
      });

      it('searches by url when scriptId is not provided', async () => {
        scriptManager.getScriptSource.mockResolvedValue(null);

        await handlers.handleGetScriptSource({ url: 'https://example.com/app.js' });

        expect(scriptManager.getScriptSource).toHaveBeenCalledWith(
          undefined,
          'https://example.com/app.js',
        );
      });

      it('searches by both scriptId and url', async () => {
        scriptManager.getScriptSource.mockResolvedValue(null);

        await handlers.handleGetScriptSource({
          scriptId: 'script-1',
          url: 'https://example.com/app.js',
        });

        expect(scriptManager.getScriptSource).toHaveBeenCalledWith(
          'script-1',
          'https://example.com/app.js',
        );
      });
    });

    describe('preview mode (default)', () => {
      it('returns preview with default maxLines=100', async () => {
        const source = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join('\n');
        scriptManager.getScriptSource.mockResolvedValue({
          scriptId: 'script-1',
          url: 'https://example.com/app.js',
          source,
        });

        const body = parseJson<GetScriptSourceResponse>(
          await handlers.handleGetScriptSource({ scriptId: 'script-1' }),
        );

        expect(body.success).toBe(true);
        expect(body.preview).toBe(true);
        expect(body.totalLines).toBe(200);
        expect(body.showingLines).toBe('1-100');
        expect(body.content?.split('\n')).toHaveLength(100);
      });

      it('respects custom maxLines', async () => {
        const source = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n');
        scriptManager.getScriptSource.mockResolvedValue({
          scriptId: 'script-1',
          url: 'test.js',
          source,
        });

        const body = parseJson<GetScriptSourceResponse>(
          await handlers.handleGetScriptSource({ scriptId: 'script-1', maxLines: 10 }),
        );

        expect(body.showingLines).toBe('1-10');
        expect(body.content?.split('\n')).toHaveLength(10);
      });

      it('shows all lines when totalLines < maxLines', async () => {
        const source = 'line1\nline2\nline3';
        scriptManager.getScriptSource.mockResolvedValue({
          scriptId: 'script-1',
          url: 'small.js',
          source,
        });

        const body = parseJson<GetScriptSourceResponse>(
          await handlers.handleGetScriptSource({ scriptId: 'script-1' }),
        );

        expect(body.totalLines).toBe(3);
        expect(body.showingLines).toBe('1-3');
        expect(body.content).toBe(source);
      });

      it('includes sizeKB in response', async () => {
        const source = 'x'.repeat(5000); // 5KB
        scriptManager.getScriptSource.mockResolvedValue({
          scriptId: 'script-1',
          url: 'test.js',
          source,
        });

        const body = parseJson<GetScriptSourceResponse>(
          await handlers.handleGetScriptSource({ scriptId: 'script-1' }),
        );

        expect(body.sizeKB).toBe('4.9KB');
      });

      it('shows large script hint when size > 51200', async () => {
        const source = 'x'.repeat(52000); // > 50KB
        scriptManager.getScriptSource.mockResolvedValue({
          scriptId: 'script-1',
          url: 'large.js',
          source,
        });

        const body = parseJson<GetScriptSourceResponse>(
          await handlers.handleGetScriptSource({ scriptId: 'script-1' }),
        );

        expect(body.hint).toContain('Script is large');
        expect(body.hint).toContain('startLine/endLine');
      });

      it('shows small script hint when size <= 51200', async () => {
        const source = 'small script';
        scriptManager.getScriptSource.mockResolvedValue({
          scriptId: 'script-1',
          url: 'small.js',
          source,
        });

        const body = parseJson<GetScriptSourceResponse>(
          await handlers.handleGetScriptSource({ scriptId: 'script-1' }),
        );

        expect(body.hint).toBe('Set preview=false to get full source');
      });
    });

    describe('ranged preview with startLine/endLine', () => {
      it('extracts lines by startLine and endLine', async () => {
        const source = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n');
        scriptManager.getScriptSource.mockResolvedValue({
          scriptId: 'script-1',
          url: 'test.js',
          source,
        });

        const body = parseJson<GetScriptSourceResponse>(
          await handlers.handleGetScriptSource({
            scriptId: 'script-1',
            startLine: 10,
            endLine: 20,
          }),
        );

        expect(body.showingLines).toBe('10-20');
        const lines = body.content?.split('\n') ?? [];
        expect(lines).toHaveLength(11); // lines 10-20 inclusive
        expect(lines[0]).toBe('line 10');
        expect(lines[10]).toBe('line 20');
      });

      it('clamps startLine to minimum 1', async () => {
        const source = 'line1\nline2\nline3';
        scriptManager.getScriptSource.mockResolvedValue({
          scriptId: 'script-1',
          url: 'test.js',
          source,
        });

        const body = parseJson<GetScriptSourceResponse>(
          await handlers.handleGetScriptSource({
            scriptId: 'script-1',
            startLine: -5,
            endLine: 2,
          }),
        );

        expect(body.showingLines).toBe('1-2');
      });

      it('clamps endLine to totalLines', async () => {
        const source = 'line1\nline2\nline3';
        scriptManager.getScriptSource.mockResolvedValue({
          scriptId: 'script-1',
          url: 'test.js',
          source,
        });

        const body = parseJson<GetScriptSourceResponse>(
          await handlers.handleGetScriptSource({
            scriptId: 'script-1',
            startLine: 2,
            endLine: 100,
          }),
        );

        expect(body.showingLines).toBe('2-3');
      });

      it('triggers preview mode when only startLine is provided', async () => {
        const source = 'line1\nline2\nline3';
        scriptManager.getScriptSource.mockResolvedValue({
          scriptId: 'script-1',
          url: 'test.js',
          source,
        });

        const body = parseJson<GetScriptSourceResponse>(
          await handlers.handleGetScriptSource({
            scriptId: 'script-1',
            startLine: 2,
          }),
        );

        // When only startLine is provided (endLine undefined),
        // the condition (startLine !== undefined && endLine !== undefined) is false
        // so it falls through to the default preview behavior
        expect(body.preview).toBe(true);
      });

      it('triggers preview mode when only endLine is provided', async () => {
        const source = 'line1\nline2\nline3';
        scriptManager.getScriptSource.mockResolvedValue({
          scriptId: 'script-1',
          url: 'test.js',
          source,
        });

        const body = parseJson<GetScriptSourceResponse>(
          await handlers.handleGetScriptSource({
            scriptId: 'script-1',
            endLine: 2,
          }),
        );

        expect(body.preview).toBe(true);
      });
    });

    describe('full source mode (preview=false)', () => {
      it('returns full source wrapped by smartHandle', async () => {
        const script = {
          scriptId: 'script-1',
          url: 'test.js',
          source: 'console.log("hello");',
        };
        scriptManager.getScriptSource.mockResolvedValue(script);
        detailedDataManager.smartHandle.mockReturnValue({
          detailId: 'detail-123',
          truncated: true,
        });

        const body = parseJson<GetScriptSourceResponse>(
          await handlers.handleGetScriptSource({ scriptId: 'script-1', preview: false }),
        );

        expect(detailedDataManager.smartHandle).toHaveBeenCalledWith(script, 51200);
        expect(body.detailId).toBe('detail-123');
        expect(body.truncated).toBe(true);
      });

      it('does not call smartHandle in preview mode', async () => {
        scriptManager.getScriptSource.mockResolvedValue({
          scriptId: 'script-1',
          url: 'test.js',
          source: 'code',
        });

        await handlers.handleGetScriptSource({ scriptId: 'script-1', preview: true });

        expect(detailedDataManager.smartHandle).not.toHaveBeenCalled();
      });

      it('uses 51200 byte limit for smartHandle', async () => {
        const script = {
          scriptId: 'script-1',
          url: 'test.js',
          source: 'x'.repeat(100000),
        };
        scriptManager.getScriptSource.mockResolvedValue(script);
        detailedDataManager.smartHandle.mockReturnValue({ processed: true });

        await handlers.handleGetScriptSource({ scriptId: 'script-1', preview: false });

        expect(detailedDataManager.smartHandle).toHaveBeenCalledWith(script, 51200);
      });
    });

    describe('edge cases', () => {
      it('handles empty source string', async () => {
        scriptManager.getScriptSource.mockResolvedValue({
          scriptId: 'script-1',
          url: 'empty.js',
          source: '',
        });

        const body = parseJson<GetScriptSourceResponse>(
          await handlers.handleGetScriptSource({ scriptId: 'script-1' }),
        );

        expect(body.success).toBe(true);
        expect(body.totalLines).toBe(1); // empty string splits to ['']
        expect(body.content).toBe('');
      });

      it('handles undefined source', async () => {
        scriptManager.getScriptSource.mockResolvedValue({
          scriptId: 'script-1',
          url: 'no-source.js',
          source: undefined,
        });

        const body = parseJson<GetScriptSourceResponse>(
          await handlers.handleGetScriptSource({ scriptId: 'script-1' }),
        );

        expect(body.success).toBe(true);
        expect(body.totalLines).toBe(1);
        expect(body.content).toBe('');
      });

      it('handles single line source', async () => {
        scriptManager.getScriptSource.mockResolvedValue({
          scriptId: 'script-1',
          url: 'oneline.js',
          source: 'console.log("one line");',
        });

        const body = parseJson<GetScriptSourceResponse>(
          await handlers.handleGetScriptSource({ scriptId: 'script-1' }),
        );

        expect(body.totalLines).toBe(1);
        expect(body.showingLines).toBe('1-1');
      });

      it('handles source with only newlines', async () => {
        scriptManager.getScriptSource.mockResolvedValue({
          scriptId: 'script-1',
          url: 'newlines.js',
          source: '\n\n\n',
        });

        const body = parseJson<GetScriptSourceResponse>(
          await handlers.handleGetScriptSource({ scriptId: 'script-1' }),
        );

        expect(body.totalLines).toBe(4);
      });
    });
  });

  describe('response structure', () => {
    it('wraps getAllScripts result in content array with type text', async () => {
      scriptManager.getAllScripts.mockResolvedValue([]);
      detailedDataManager.smartHandle.mockReturnValue({});

      const response = await handlers.handleGetAllScripts({});

      expect(response.content).toHaveLength(1);
      expect(response.content[0]?.type).toBe('text');
      expect(() => JSON.parse(response.content[0]!.text)).not.toThrow();
    });

    it('wraps getScriptSource result in content array with type text', async () => {
      scriptManager.getScriptSource.mockResolvedValue(null);

      const response = await handlers.handleGetScriptSource({});

      expect(response.content).toHaveLength(1);
      expect(response.content[0]?.type).toBe('text');
    });

    it('formats JSON with 2-space indentation', async () => {
      scriptManager.getAllScripts.mockResolvedValue([{ scriptId: '1' }]);
      detailedDataManager.smartHandle.mockImplementation((v) => v);

      const response = await handlers.handleGetAllScripts({});
      const text = response.content[0]!.text;

      expect(text).toContain('\n  ');
    });
  });
});
