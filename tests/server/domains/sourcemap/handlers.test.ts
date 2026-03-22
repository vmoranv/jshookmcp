import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SourcemapToolHandlers } from '@server/domains/sourcemap/handlers';



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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  } as any;

  let handlers: SourcemapToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new SourcemapToolHandlers(collector);
  });

  it('returns error when sourceMapUrl is missing in fetch_and_parse', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(await handlers.handleSourcemapFetchAndParse({}));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.tool).toBe('sourcemap_fetch_and_parse');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toContain('sourceMapUrl');
  });

  it('returns parsed source map summary', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    vi.spyOn(handlers as any, 'parseSourceMap').mockResolvedValue({
      resolvedUrl: 'https://a.map',
      map: { sources: ['a.ts'], sourcesContent: ['const a=1;'] },
      mappings: [],
      mappingsCount: 2,
      segmentCount: 3,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(
      await handlers.handleSourcemapFetchAndParse({ sourceMapUrl: 'https://a.map' })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.sources).toEqual(['a.ts']);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.mappingsCount).toBe(2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.sourcesContent).toEqual(['const a=1;']);
  });

  it('lists installed extensions from extension targets', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    vi.spyOn(handlers as any, 'getExtensionTargets').mockResolvedValue([
      {
        extensionId: 'ext1',
        name: 'A',
        type: 'service_worker',
        url: 'chrome-extension://ext1/bg',
        targetId: 't1',
      },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(await handlers.handleExtensionListInstalled({}));
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    vi.spyOn(handlers as any, 'getExtensionTargets').mockResolvedValue([]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(
      await handlers.handleExtensionExecuteInContext({
        extensionId: 'missing',
        code: '1+1',
      })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.tool).toBe('extension_execute_in_context');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toContain('No background target found');
  });

  it('executes code in extension context and returns result', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    vi.spyOn(handlers as any, 'getExtensionTargets').mockResolvedValue([
      { extensionId: 'ext1', name: 'A', type: 'service_worker', url: 'x', targetId: 'tid' },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    vi.spyOn(handlers as any, 'evaluateInAttachedTarget').mockResolvedValue({
      result: { value: 42 },
      exceptionDetails: null,
    });
    session.send.mockResolvedValue({ sessionId: 'sid-1' });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(
      await handlers.handleExtensionExecuteInContext({
        extensionId: 'ext1',
        code: '(() => 42)()',
      })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.extensionId).toBe('ext1');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.result).toEqual({ value: 42 });
    expect(session.send).toHaveBeenCalledWith('Target.attachToTarget', {
      targetId: 'tid',
      flatten: true,
    });
  });

  it('throws immediately when extensionId is missing', async () => {
    await expect(handlers.handleExtensionExecuteInContext({ code: '1' })).rejects.toThrow(
      /extensionId/
    );
  });
});
