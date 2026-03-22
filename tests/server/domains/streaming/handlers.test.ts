import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StreamingToolHandlers } from '@server/domains/streaming/handlers';



describe('StreamingToolHandlers', () => {
  const session = {
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    detach: vi.fn(),
  };
  const page = {
    createCDPSession: vi.fn(async () => session),
    evaluate: vi.fn(),
  };
  const collector = {
    getActivePage: vi.fn(async () => page),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  } as any;

  let handlers: StreamingToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new StreamingToolHandlers(collector);
  });

  it('validates ws monitor urlFilter regex', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson(await handlers.handleWsMonitorEnable({ urlFilter: '[' }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toContain('Invalid urlFilter regex');
  });

  it('enables ws monitor with sanitized config', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson(
      await handlers.handleWsMonitorEnable({ maxFrames: 5, urlFilter: 'api' })
    );
    expect(session.send).toHaveBeenCalledWith('Network.enable');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.config.maxFrames).toBe(5);
  });

  it('validates ws payloadFilter regex on get frames', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson(await handlers.handleWsGetFrames({ payloadFilter: '[' }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toContain('Invalid payloadFilter regex');
  });

  it('filters ws frames by direction and pagination', async () => {
    await handlers.handleWsMonitorEnable({ maxFrames: 10 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (handlers as any).wsFrameOrder.push({
      requestId: 'r1',
      frame: {
        requestId: 'r1',
        timestamp: 1,
        direction: 'sent',
        opcode: 1,
        payloadLength: 3,
        payloadPreview: 'abc',
        payloadSample: 'abc',
        isBinary: false,
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (handlers as any).wsFrameOrder.push({
      requestId: 'r1',
      frame: {
        requestId: 'r1',
        timestamp: 2,
        direction: 'received',
        opcode: 1,
        payloadLength: 4,
        payloadPreview: 'pong',
        payloadSample: 'pong',
        isBinary: false,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson(
      await handlers.handleWsGetFrames({ direction: 'received', limit: 1, offset: 0 })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.frames.length).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.frames[0].direction).toBe('received');
  });

  it('disables ws monitor and returns summary', async () => {
    await handlers.handleWsMonitorEnable({ maxFrames: 10 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (handlers as any).wsConnections.set('a', {
      requestId: 'a',
      url: 'wss://x',
      status: 'open',
      framesCount: 1,
      createdTimestamp: 1,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (handlers as any).wsFrameOrder.push({
      requestId: 'a',
      frame: {
        requestId: 'a',
        timestamp: 1,
        direction: 'sent',
        opcode: 1,
        payloadLength: 1,
        payloadPreview: 'x',
        payloadSample: 'x',
        isBinary: false,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson(await handlers.handleWsMonitorDisable({}));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.summary.totalFrames).toBeGreaterThan(0);
    expect(session.detach).toHaveBeenCalled();
  });

  it('validates sse monitor regex', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson(await handlers.handleSseMonitorEnable({ urlFilter: '[' }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toContain('Invalid urlFilter regex');
  });
});
