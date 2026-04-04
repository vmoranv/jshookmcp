/**
 * SSE Stream handler tests for real-time progress visualization.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventBus, ServerEventMap, createServerEventBus } from '@server/EventBus';
import { SseStream, createProgressHandler } from '@server/http/SseStream';
import type { ServerResponse, IncomingMessage } from 'node:http';

// Mock ServerResponse factory - must be called within test scope where vi is available
function createMockResponseFactory() {
  return function createMockResponse() {
    const writes: string[] = [];
    const eventListeners = new Map<string, Array<() => void>>();

    const mockRes = {
      writes,
      ended: false,
      writableEnded: false,
      writeHead: vi.fn((_status, _headers) => mockRes),
      setHeader: vi.fn(),
      write: vi.fn((chunk: string) => {
        writes.push(chunk);
        return true;
      }),
      end: vi.fn(() => {
        mockRes.ended = true;
        mockRes.writableEnded = true;
      }),
      on: vi.fn((event: string, handler: () => void) => {
        const handlers = eventListeners.get(event) || [];
        handlers.push(handler);
        eventListeners.set(event, handlers);
      }),
      off: vi.fn(),
      once: vi.fn(),
      removeListener: vi.fn(),
      destroy: vi.fn(),
    };

    return mockRes as unknown as ServerResponse & {
      writes: string[];
      ended: boolean;
      writableEnded: boolean;
      _triggerClose: () => void;
    } & { _triggerClose: () => void };
  };
}

describe('SseStream', () => {
  let eventBus: EventBus<ServerEventMap>;
  let mockRes: ReturnType<ReturnType<typeof createMockResponseFactory>>;
  let createMockRes: ReturnType<typeof createMockResponseFactory>;

  beforeEach(() => {
    eventBus = createServerEventBus();
    createMockRes = createMockResponseFactory();
    mockRes = createMockRes();
  });

  afterEach(() => {
    eventBus.removeAllListeners();
  });

  it('should initialize with eventBus', () => {
    const stream = new SseStream(eventBus);
    expect(stream).toBeDefined();
  });

  it('should initialize with sessionId option', () => {
    const stream = new SseStream(eventBus, { sessionId: 'test-123' });
    expect(stream).toBeDefined();
  });

  it('should start streaming and send connected event', () => {
    const stream = new SseStream(eventBus);
    stream.start(mockRes);

    expect(mockRes.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    expect(mockRes.writes.some((w) => w.includes('event: connected'))).toBe(true);
  });

  it('should emit task:update events', async () => {
    const stream = new SseStream(eventBus);
    stream.start(mockRes);

    await eventBus.emit('task:update', {
      taskId: 'task-1',
      status: 'in_progress',
      timestamp: new Date().toISOString(),
      data: { description: 'Test task' },
    });

    // Wait for async write
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(
      mockRes.writes.some((w) => w.includes('event: task:update') && w.includes('task-1')),
    ).toBe(true);
  });

  it('should filter events by sessionId', async () => {
    const stream = new SseStream(eventBus, { sessionId: 'session-a' });
    stream.start(mockRes);

    // Emit event with different sessionId
    await eventBus.emit('task:update', {
      taskId: 'task-1',
      status: 'completed',
      sessionId: 'session-b',
      timestamp: new Date().toISOString(),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should not receive the event (filtered out)
    const taskUpdates = mockRes.writes.filter((w) => w.includes('event: task:update'));
    expect(taskUpdates.length).toBe(0);
  });

  it('should receive events with matching sessionId', async () => {
    const stream = new SseStream(eventBus, { sessionId: 'session-a' });
    stream.start(mockRes);

    await eventBus.emit('task:update', {
      taskId: 'task-1',
      status: 'completed',
      sessionId: 'session-a',
      timestamp: new Date().toISOString(),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(
      mockRes.writes.some((w) => w.includes('event: task:update') && w.includes('session-a')),
    ).toBe(true);
  });

  it('should close and cleanup', () => {
    const stream = new SseStream(eventBus);
    stream.start(mockRes);
    stream.close();

    expect(mockRes.ended).toBe(true);
  });
});

describe('createProgressHandler', () => {
  let eventBus: EventBus<ServerEventMap>;
  let mockRes: ReturnType<ReturnType<typeof createMockResponseFactory>>;
  let mockReq: Partial<IncomingMessage>;
  let createMockRes: ReturnType<typeof createMockResponseFactory>;

  beforeEach(() => {
    eventBus = createServerEventBus();
    createMockRes = createMockResponseFactory();
    mockRes = createMockRes();
    mockReq = {
      method: 'GET',
      url: '/progress/test-session',
    };
  });

  afterEach(() => {
    eventBus.removeAllListeners();
  });

  it('should create handler function', () => {
    const handler = createProgressHandler(eventBus);
    expect(handler).toBeDefined();
    expect(typeof handler).toBe('function');
  });

  it('should handle GET requests', () => {
    const handler = createProgressHandler(eventBus);
    handler(mockReq as IncomingMessage, mockRes, 'test-session');

    expect(mockRes.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
  });

  it('should reject non-GET requests', () => {
    const handler = createProgressHandler(eventBus);
    mockReq.method = 'POST';

    handler(mockReq as IncomingMessage, mockRes, 'test-session');

    expect(mockRes.writeHead).toHaveBeenCalledWith(405, expect.any(Object));
  });

  it('should handle OPTIONS preflight', () => {
    const handler = createProgressHandler(eventBus);
    mockReq.method = 'OPTIONS';

    handler(mockReq as IncomingMessage, mockRes, 'test-session');

    expect(mockRes.writeHead).toHaveBeenCalledWith(204);
  });

  it('should set CORS headers', () => {
    const handler = createProgressHandler(eventBus);
    handler(mockReq as IncomingMessage, mockRes, 'test-session');

    expect(mockRes.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
  });
});
