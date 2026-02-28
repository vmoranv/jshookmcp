import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StreamingToolHandlers } from '../../../../src/server/domains/streaming/handlers.js';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

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
  } as any;

  let handlers: StreamingToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new StreamingToolHandlers(collector);
  });

  it('validates ws monitor urlFilter regex', async () => {
    const body = parseJson(await handlers.handleWsMonitorEnable({ urlFilter: '[' }));
    expect(body.success).toBe(false);
    expect(body.error).toContain('Invalid urlFilter regex');
  });

  it('enables ws monitor with sanitized config', async () => {
    const body = parseJson(await handlers.handleWsMonitorEnable({ maxFrames: 5, urlFilter: 'api' }));
    expect(session.send).toHaveBeenCalledWith('Network.enable');
    expect(body.success).toBe(true);
    expect(body.config.maxFrames).toBe(5);
  });

  it('validates ws payloadFilter regex on get frames', async () => {
    const body = parseJson(await handlers.handleWsGetFrames({ payloadFilter: '[' }));
    expect(body.success).toBe(false);
    expect(body.error).toContain('Invalid payloadFilter regex');
  });

  it('filters ws frames by direction and pagination', async () => {
    await handlers.handleWsMonitorEnable({ maxFrames: 10 });
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

    const body = parseJson(await handlers.handleWsGetFrames({ direction: 'received', limit: 1, offset: 0 }));
    expect(body.success).toBe(true);
    expect(body.frames.length).toBe(1);
    expect(body.frames[0].direction).toBe('received');
  });

  it('disables ws monitor and returns summary', async () => {
    await handlers.handleWsMonitorEnable({ maxFrames: 10 });
    (handlers as any).wsConnections.set('a', {
      requestId: 'a',
      url: 'wss://x',
      status: 'open',
      framesCount: 1,
      createdTimestamp: 1,
    });
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

    const body = parseJson(await handlers.handleWsMonitorDisable({}));
    expect(body.success).toBe(true);
    expect(body.summary.totalFrames).toBeGreaterThan(0);
    expect(session.detach).toHaveBeenCalled();
  });

  it('validates sse monitor regex', async () => {
    const body = parseJson(await handlers.handleSseMonitorEnable({ urlFilter: '[' }));
    expect(body.success).toBe(false);
    expect(body.error).toContain('Invalid urlFilter regex');
  });
});

