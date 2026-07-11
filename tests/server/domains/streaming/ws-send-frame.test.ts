import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StreamingToolHandlers } from '@server/domains/streaming/handlers';
import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { TEST_WS_URLS, withPath } from '@tests/shared/test-urls';

const WS_URL = withPath(TEST_WS_URLS.api, 'socket');

describe('ws_send_frame', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends a text payload through a live WebSocket instance', async () => {
    const page = {
      evaluate: vi.fn().mockResolvedValue({
        success: true,
        url: WS_URL,
        readyState: 1,
        bytesSent: 5,
        binary: false,
      }),
    };
    const handlers = new StreamingToolHandlers({
      getActivePage: vi.fn().mockResolvedValue(page),
    } as any);

    const body = parseJson<any>(
      await handlers.handleWsSendFrame({ url: WS_URL, payload: 'hello' }),
    );

    expect(body).toMatchObject({
      success: true,
      url: WS_URL,
      bytesSent: 5,
      binary: false,
    });
  });

  it('sends a base64 binary payload when binary=true', async () => {
    const page = {
      evaluate: vi.fn().mockResolvedValue({
        success: true,
        url: WS_URL,
        readyState: 1,
        bytesSent: 3,
        binary: true,
      }),
    };
    const handlers = new StreamingToolHandlers({
      getActivePage: vi.fn().mockResolvedValue(page),
    } as any);

    const body = parseJson<any>(
      await handlers.handleWsSendFrame({
        url: WS_URL,
        payload: 'AAAA',
        binary: true,
      }),
    );

    expect(body).toMatchObject({ success: true, bytesSent: 3, binary: true });
  });

  it('returns a soft failure when instance exposure is not enabled', async () => {
    const page = {
      evaluate: vi.fn().mockResolvedValue({
        success: false,
        message:
          'WebSocket instance exposure is not enabled. Call ws_monitor with exposeInstances=true first.',
      }),
    };
    const handlers = new StreamingToolHandlers({
      getActivePage: vi.fn().mockResolvedValue(page),
    } as any);

    const body = parseJson<any>(await handlers.handleWsSendFrame({ url: WS_URL, payload: 'hi' }));

    expect(body.success).toBe(false);
    expect(body.message).toMatch(/not enabled/);
  });

  it('returns a soft failure when no OPEN instance exists for the url', async () => {
    const page = {
      evaluate: vi.fn().mockResolvedValue({
        success: false,
        message: 'Found 1 instance(s) for this url but none in OPEN state (readyState=1).',
        readyStates: [3],
      }),
    };
    const handlers = new StreamingToolHandlers({
      getActivePage: vi.fn().mockResolvedValue(page),
    } as any);

    const body = parseJson<any>(await handlers.handleWsSendFrame({ url: WS_URL, payload: 'hi' }));

    expect(body.success).toBe(false);
    expect(body.message).toMatch(/none in OPEN state/);
  });

  it('rejects a missing url', async () => {
    const handlers = new StreamingToolHandlers({ getActivePage: vi.fn() } as any);
    const body = parseJson<any>(await handlers.handleWsSendFrame({ payload: 'hi' }));
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/url is required/);
  });

  it('rejects a missing payload', async () => {
    const handlers = new StreamingToolHandlers({ getActivePage: vi.fn() } as any);
    const body = parseJson<any>(await handlers.handleWsSendFrame({ url: WS_URL }));
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/payload is required/);
  });
});

describe('ws_monitor exposeInstances', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createEnableMocks() {
    const session = {
      send: vi.fn().mockResolvedValue({}),
      on: vi.fn(),
      off: vi.fn(),
      detach: vi.fn(),
    };
    const page = {
      createCDPSession: vi.fn().mockResolvedValue(session),
      evaluate: vi.fn().mockResolvedValue({ success: true, patched: true }),
    };
    const handlers = new StreamingToolHandlers({
      getActivePage: vi.fn().mockResolvedValue(page),
    } as any);
    return { session, page, handlers };
  }

  it('installs the in-page instance wrapper when exposeInstances=true', async () => {
    const { page, handlers } = createEnableMocks();
    const body = parseJson<any>(
      await handlers.handleWsMonitorDispatch({ action: 'enable', exposeInstances: true }),
    );
    expect(body.success).toBe(true);
    expect(body.config.exposeInstances).toBe(true);
    // evaluate is called for the instance-exposure injection (pass-through mock).
    expect(page.evaluate).toHaveBeenCalled();
  });

  it('does not install the wrapper when exposeInstances is omitted', async () => {
    const { page, handlers } = createEnableMocks();
    const body = parseJson<any>(await handlers.handleWsMonitorDispatch({ action: 'enable' }));
    expect(body.success).toBe(true);
    expect(body.config.exposeInstances).toBe(false);
    expect(page.evaluate).not.toHaveBeenCalled();
  });
});
