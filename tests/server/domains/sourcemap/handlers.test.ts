import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SourcemapToolHandlers } from '../../../../src/server/domains/sourcemap/handlers.js';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('SourcemapToolHandlers', () => {
  const session = {
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    detach: vi.fn(),
  };
  const page = {
    createCDPSession: vi.fn(async () => session),
  };
  const collector = {
    getActivePage: vi.fn(async () => page),
  } as any;

  let handlers: SourcemapToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new SourcemapToolHandlers(collector);
  });

  it('returns error when sourceMapUrl is missing in fetch_and_parse', async () => {
    const body = parseJson(await handlers.handleSourcemapFetchAndParse({}));
    expect(body.success).toBe(false);
    expect(body.tool).toBe('sourcemap_fetch_and_parse');
    expect(body.error).toContain('sourceMapUrl');
  });

  it('returns parsed source map summary', async () => {
    vi.spyOn(handlers as any, 'parseSourceMap').mockResolvedValue({
      resolvedUrl: 'https://a.map',
      map: { sources: ['a.ts'], sourcesContent: ['const a=1;'] },
      mappings: [],
      mappingsCount: 2,
      segmentCount: 3,
    });

    const body = parseJson(
      await handlers.handleSourcemapFetchAndParse({ sourceMapUrl: 'https://a.map' })
    );
    expect(body.sources).toEqual(['a.ts']);
    expect(body.mappingsCount).toBe(2);
    expect(body.sourcesContent).toEqual(['const a=1;']);
  });

  it('lists installed extensions from extension targets', async () => {
    vi.spyOn(handlers as any, 'getExtensionTargets').mockResolvedValue([
      { extensionId: 'ext1', name: 'A', type: 'service_worker', url: 'chrome-extension://ext1/bg', targetId: 't1' },
    ]);

    const body = parseJson(await handlers.handleExtensionListInstalled({}));
    expect(body).toEqual([
      {
        extensionId: 'ext1',
        name: 'A',
        type: 'service_worker',
        url: 'chrome-extension://ext1/bg',
      },
    ]);
    expect(session.detach).toHaveBeenCalledOnce();
  });

  it('returns failure when extension target is not found', async () => {
    vi.spyOn(handlers as any, 'getExtensionTargets').mockResolvedValue([]);

    const body = parseJson(
      await handlers.handleExtensionExecuteInContext({
        extensionId: 'missing',
        code: '1+1',
      })
    );
    expect(body.success).toBe(false);
    expect(body.tool).toBe('extension_execute_in_context');
    expect(body.error).toContain('No background target found');
  });

  it('executes code in extension context and returns result', async () => {
    vi.spyOn(handlers as any, 'getExtensionTargets').mockResolvedValue([
      { extensionId: 'ext1', name: 'A', type: 'service_worker', url: 'x', targetId: 'tid' },
    ]);
    vi.spyOn(handlers as any, 'evaluateInAttachedTarget').mockResolvedValue({
      result: { value: 42 },
      exceptionDetails: null,
    });
    session.send.mockResolvedValue({ sessionId: 'sid-1' });

    const body = parseJson(
      await handlers.handleExtensionExecuteInContext({
        extensionId: 'ext1',
        code: '(() => 42)()',
      })
    );
    expect(body.extensionId).toBe('ext1');
    expect(body.result).toEqual({ value: 42 });
    expect(session.send).toHaveBeenCalledWith('Target.attachToTarget', {
      targetId: 'tid',
      flatten: true,
    });
  });

  it('throws immediately when extensionId is missing', async () => {
    await expect(
      handlers.handleExtensionExecuteInContext({ code: '1' })
    ).rejects.toThrow(/extensionId/);
  });
});

