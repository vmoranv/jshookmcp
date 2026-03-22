import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BlackboxHandlers } from '@server/domains/debugger/handlers/blackbox-handlers';


describe('BlackboxHandlers', () => {
  const blackboxManager = {
    blackboxByPattern: vi.fn(),
    blackboxCommonLibraries: vi.fn(),
    getAllBlackboxedPatterns: vi.fn(),
  };

  function createDebuggerManager(withAdvancedFeatures = true) {
    return {
      getBlackboxManager: vi.fn(() => blackboxManager),
      ...(withAdvancedFeatures
        ? {
            ensureAdvancedFeatures: vi.fn().mockResolvedValue(undefined),
          }
        : {}),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds a blackbox pattern and enables advanced features when supported', async () => {
    const debuggerManager = createDebuggerManager(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const handlers = new BlackboxHandlers({ debuggerManager } as any);

    const body = parseJson<any>(await handlers.handleBlackboxAdd({ urlPattern: 'vendor/*.js' }));

    expect(debuggerManager.ensureAdvancedFeatures).toHaveBeenCalledOnce();
    expect(debuggerManager.getBlackboxManager).toHaveBeenCalledOnce();
    expect(blackboxManager.blackboxByPattern).toHaveBeenCalledWith('vendor/*.js');
    expect(body).toEqual({
      success: true,
      message: 'Script pattern blackboxed',
      urlPattern: 'vendor/*.js',
    });
  });

  it('adds common patterns even when advanced features are not supported', async () => {
    const debuggerManager = createDebuggerManager(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const handlers = new BlackboxHandlers({ debuggerManager } as any);

    const body = parseJson<any>(await handlers.handleBlackboxAddCommon({}));

    expect(debuggerManager.getBlackboxManager).toHaveBeenCalledOnce();
    expect(blackboxManager.blackboxCommonLibraries).toHaveBeenCalledOnce();
    expect(body).toEqual({
      success: true,
      message: 'Blackboxed common library patterns',
    });
  });

  it('returns a structured error when adding a pattern fails', async () => {
    const debuggerManager = createDebuggerManager(true);
    blackboxManager.blackboxByPattern.mockRejectedValueOnce(new Error('boom'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const handlers = new BlackboxHandlers({ debuggerManager } as any);

    const body = parseJson<any>(await handlers.handleBlackboxAdd({ urlPattern: 'bad' }));

    expect(body).toEqual({
      success: false,
      message: 'Failed to add blackbox pattern',
      error: 'boom',
    });
  });

  it('lists all configured blackbox patterns', async () => {
    const debuggerManager = createDebuggerManager(true);
    blackboxManager.getAllBlackboxedPatterns.mockReturnValueOnce(['vendor/*.js', 'react-dom*.js']);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const handlers = new BlackboxHandlers({ debuggerManager } as any);

    const body = parseJson<any>(await handlers.handleBlackboxList({}));

    expect(body).toEqual({
      success: true,
      message: 'Found 2 blackboxed pattern(s)',
      patterns: ['vendor/*.js', 'react-dom*.js'],
    });
  });
});
