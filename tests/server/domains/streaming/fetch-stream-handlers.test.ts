/**
 * Direct tests for FetchStreamHandlers — fetch()-based SSE capture.
 *
 * The injection function is serialized and run in a VM (via runInNewContext)
 * with a mocked window.fetch that returns text/event-stream bodies whose
 * chunks deliberately span SSE frame boundaries, exercising the parser's
 * buffer reassembly.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';

import { FetchStreamHandlers } from '@server/domains/streaming/handlers/fetch-stream-handlers';
import {
  createStreamingSharedState,
  type StreamingSharedState,
} from '@server/domains/streaming/handlers/shared';

/** Build a ReadableStream-like body that emits the given string chunks on read(). */
function mockBody(chunks: string[]) {
  let i = 0;
  return {
    getReader: () => ({
      read: async () => {
        if (i < chunks.length) {
          const text = chunks[i]!;
          i += 1;
          return { done: false, value: new TextEncoder().encode(text) };
        }
        return { done: true, value: undefined };
      },
    }),
  };
}

function mockResponse(contentType: string, chunks: string[]) {
  return {
    headers: {
      get: (name: string) => (String(name).toLowerCase() === 'content-type' ? contentType : null),
    },
    clone: () => mockResponse(contentType, chunks),
    body: mockBody(chunks),
  };
}

interface MockWindow {
  fetch: (url: string) => Promise<unknown>;
  __jshookFetchStreamMonitor?: Record<string, unknown>;
}

function createState(): {
  state: StreamingSharedState;
  win: MockWindow;
  routes: Map<string, { ct: string; chunks: string[] }>;
  page: { evaluate: ReturnType<typeof vi.fn> };
} {
  // NOTE: the injection binds window.fetch (originalFetch = gw.fetch.bind(gw)).
  // A bound vitest mock does not honour mockImplementation/mockResolvedValueOnce
  // set after bind time, so we drive per-URL responses through a PLAIN function
  // backed by a mutable routes map (no vitest mock magic in the bound path).
  const routes = new Map<string, { ct: string; chunks: string[] }>();
  const win: MockWindow = {
    fetch: async (url: string) => {
      for (const [key, v] of routes) {
        if (url.includes(key)) return mockResponse(v.ct, v.chunks);
      }
      return mockResponse('text/event-stream', []);
    },
  };
  const page = { evaluate: vi.fn() };
  const collector = {
    getActivePage: vi.fn(async () => page),
  } as unknown as StreamingSharedState['collector'];
  const state = createStreamingSharedState(collector);
  return { state, win, routes, page };
}

/** Wire page.evaluate to run the serialized injection/query in a VM with our mocked window. */
function wireEvaluate(page: { evaluate: ReturnType<typeof vi.fn> }, win: MockWindow): void {
  page.evaluate.mockImplementation(async (pageFunction: unknown, arg: unknown) => {
    const serialized = `(${String(pageFunction)})`;
    // The injection references browser globals (window, TextDecoder, Request).
    // Provide them so the serialized code runs faithfully under node:vm.
    const fn = runInNewContext(serialized, {
      window: win,
      TextDecoder,
      TextEncoder,
      Request: globalThis.Request,
      Response: globalThis.Response,
    }) as (input: unknown) => unknown;
    return fn(arg);
  });
}

const drain = () => new Promise<void>((r) => setTimeout(r, 50));

describe('FetchStreamHandlers', () => {
  let env: ReturnType<typeof createState>;
  let handlers: FetchStreamHandlers;

  beforeEach(() => {
    env = createState();
    wireEvaluate(env.page, env.win);
    handlers = new FetchStreamHandlers(env.state);
  });

  it('parses SSE frames emitted across chunk boundaries', async () => {
    const enable = await handlers.handleFetchStreamMonitorEnable({ action: 'enable' });
    expect(JSON.parse(enable.content[0]!.text).success).toBe(true);

    // Two events; the second spans two chunks (tests buffer reassembly).
    env.routes.set('chat', {
      ct: 'text/event-stream',
      chunks: ['data: hello\n\n', 'event: ping\ndata: ', 'world\n\n'],
    });

    await env.win.fetch('https://stream-host/v1/chat');
    await drain();

    const result = JSON.parse(
      (await handlers.handleFetchStreamGetEvents({ fullData: true })).content[0]!.text,
    );
    expect(result.success).toBe(true);
    expect(result.events).toHaveLength(2);
    expect(result.events[0].eventType).toBe('message');
    expect(result.events[0].data).toBe('hello');
    expect(result.events[1].eventType).toBe('ping');
    expect(result.events[1].data).toBe('world');
  });

  it('ignores non-event-stream responses', async () => {
    await handlers.handleFetchStreamMonitorEnable({ action: 'enable' });
    env.routes.set('api', { ct: 'application/json', chunks: ['{"x":1}'] });
    await env.win.fetch('https://stream-host/api');
    await drain();
    const result = JSON.parse((await handlers.handleFetchStreamGetEvents({})).content[0]!.text);
    expect(result.events).toHaveLength(0);
  });

  it('honors urlFilter', async () => {
    await handlers.handleFetchStreamMonitorEnable({ action: 'enable', urlFilter: 'chat' });
    env.routes.set('chat', { ct: 'text/event-stream', chunks: ['data: a\n\n'] });
    env.routes.set('other', { ct: 'text/event-stream', chunks: ['data: b\n\n'] });
    await env.win.fetch('https://stream-host/v1/chat'); // matches
    await env.win.fetch('https://stream-host/v1/other'); // filtered out
    await drain();
    const result = JSON.parse((await handlers.handleFetchStreamGetEvents({})).content[0]!.text);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].dataPreview).toBe('a');
  });

  it('parses id: and multi-line data: fields', async () => {
    await handlers.handleFetchStreamMonitorEnable({ action: 'enable' });
    env.routes.set('multi', {
      ct: 'text/event-stream',
      chunks: ['id: 42\ndata: line1\ndata: line2\n\n'],
    });
    await env.win.fetch('https://stream-host/multi');
    await drain();
    const result = JSON.parse(
      (await handlers.handleFetchStreamGetEvents({ fullData: true })).content[0]!.text,
    );
    expect(result.events[0].data).toBe('line1\nline2');
    expect(result.events[0].lastEventId).toBe('42');
  });

  it('skips SSE comment/heartbeat lines', async () => {
    await handlers.handleFetchStreamMonitorEnable({ action: 'enable' });
    env.routes.set('hb', {
      ct: 'text/event-stream',
      chunks: [': heartbeat\n\n', 'data: real\n\n'],
    });
    await env.win.fetch('https://stream-host/hb');
    await drain();
    const result = JSON.parse((await handlers.handleFetchStreamGetEvents({})).content[0]!.text);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].dataPreview).toBe('real');
  });

  it('rejects an invalid urlFilter', async () => {
    const result = JSON.parse(
      (await handlers.handleFetchStreamMonitorEnable({ action: 'enable', urlFilter: '(' }))
        .content[0]!.text,
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid urlFilter regex/);
  });

  it('disable pauses capture (enabled=false)', async () => {
    await handlers.handleFetchStreamMonitorEnable({ action: 'enable' });
    const result = JSON.parse(
      (await handlers.handleFetchStreamMonitorDisable({ action: 'disable' })).content[0]!.text,
    );
    expect(result.success).toBe(true);
    const mon = (env.win as unknown as Record<string, { enabled: boolean } | undefined>)[
      '__jshookFetchStreamMonitor'
    ];
    expect(mon?.enabled).toBe(false);
  });
});
