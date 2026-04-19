import { parseJson } from '@tests/server/domains/shared/mock-factories';
import type { BrowserStatusResponse } from '@tests/shared/common-test-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ScriptManagementHandlers } from '@server/domains/browser/handlers/script-management';

describe('ScriptManagementHandlers', () => {
  const scriptManager = {
    getAllScripts: vi.fn(),
    getScriptSource: vi.fn(),
  } as any;
  const detailedDataManager = {
    smartHandle: vi.fn(),
  } as any;

  let handlers: ScriptManagementHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new ScriptManagementHandlers({ scriptManager, detailedDataManager });
  });

  it('wraps getAllScripts results and applies default includeSource/maxScripts values', async () => {
    const scripts = [{ scriptId: '1' }, { scriptId: '2' }];
    scriptManager.getAllScripts.mockResolvedValue(scripts);
    detailedDataManager.smartHandle.mockReturnValue({
      success: true,
      wrapped: { count: 2, scripts },
    });

    const body = parseJson<BrowserStatusResponse>(await handlers.handleGetAllScripts({}));

    expect(scriptManager.getAllScripts).toHaveBeenCalledWith(false, 500);
    expect(detailedDataManager.smartHandle).toHaveBeenCalledWith({
      count: 2,
      scripts,
    });
    expect(body).toEqual({
      success: true,
      wrapped: { count: 2, scripts },
    });
  });

  it('returns not found payload when script source is missing', async () => {
    scriptManager.getScriptSource.mockResolvedValue(null);

    const body = parseJson<BrowserStatusResponse>(
      await handlers.handleGetScriptSource({
        scriptId: 'missing-script',
        url: 'https://example.test/app.js',
      }),
    );

    expect(scriptManager.getScriptSource).toHaveBeenCalledWith(
      'missing-script',
      'https://example.test/app.js',
    );
    expect(body).toEqual({
      success: false,
      error: 'Script not found',
      message: 'Script not found',
    });
  });

  it('returns preview content with default maxLines and small-script hint', async () => {
    scriptManager.getScriptSource.mockResolvedValue({
      scriptId: 'script-1',
      url: 'https://example.test/app.js',
      source: ['first line', 'second line', 'third line'].join('\n'),
    });

    const body = parseJson<BrowserStatusResponse>(
      await handlers.handleGetScriptSource({ scriptId: 'script-1', preview: true }),
    );

    expect(body).toMatchObject({
      success: true,
      scriptId: 'script-1',
      url: 'https://example.test/app.js',
      preview: true,
      totalLines: 3,
      showingLines: '1-3',
      content: ['first line', 'second line', 'third line'].join('\n'),
      hint: 'Set preview=false to get full source',
    });
  });

  it('supports ranged previews and large-script hint', async () => {
    const largeLines = ['line-1', 'line-2', 'line-3', 'x'.repeat(52010)];
    scriptManager.getScriptSource.mockResolvedValue({
      scriptId: 'script-2',
      url: 'https://example.test/large.js',
      source: largeLines.join('\n'),
    });

    const body = parseJson<BrowserStatusResponse>(
      await handlers.handleGetScriptSource({
        scriptId: 'script-2',
        startLine: 2,
        endLine: 3,
      }),
    );

    expect(body.success).toBe(true);
    expect(body.showingLines).toBe('2-3');
    expect(body.content).toBe(['line-2', 'line-3'].join('\n'));
    expect(body.hint).toContain('Script is large');
    expect(body.hint).toContain('startLine/endLine');
  });

  it('wraps full script responses with smartHandle and size limit', async () => {
    const script = {
      scriptId: 'script-3',
      url: 'https://example.test/full.js',
      source: 'console.log("hello");',
    };
    scriptManager.getScriptSource.mockResolvedValue(script);
    detailedDataManager.smartHandle.mockReturnValue({
      detailId: 'detail-123',
      truncated: true,
    });

    const body = parseJson<BrowserStatusResponse>(
      await handlers.handleGetScriptSource({ scriptId: 'script-3', preview: false }),
    );

    expect(detailedDataManager.smartHandle).toHaveBeenCalledWith(script, 51200);
    expect(body.success).toBe(true);
    expect(body.detailId).toBe('detail-123');
    expect(body.truncated).toBe(true);
  });
});
