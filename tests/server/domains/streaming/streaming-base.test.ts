import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StreamingToolHandlersBase } from '@server/domains/streaming/handlers.impl.streaming-base';
import type {
  TextToolResponse,
  WsFrameRecord,
} from '@server/domains/streaming/handlers.impl.streaming-base';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
function parseJson(response: TextToolResponse): any {
  return JSON.parse(response.content[0].text);
}

/**
 * Concrete subclass to expose protected members for testing.
 */
class TestableBase extends StreamingToolHandlersBase {
  // Expose protected helpers
  callAsJson(payload: unknown) {
    return this.asJson(payload);
  }

  callParseOptionalStringArg(value: unknown) {
    return this.parseOptionalStringArg(value);
  }

  callParseNumberArg(
    value: unknown,
    options: { defaultValue: number; min: number; max: number; integer?: boolean }
  ) {
    return this.parseNumberArg(value, options);
  }

  callParseWsDirection(value: unknown) {
    return this.parseWsDirection(value);
  }

  callCompileRegex(pattern: string) {
    return this.compileRegex(pattern);
  }

  callGetWsFrameStats() {
    return this.getWsFrameStats();
  }

  callAppendWsFrame(requestId: string, frame: WsFrameRecord) {
    this.appendWsFrame(requestId, frame);
  }

  callEnforceWsFrameLimit() {
    this.enforceWsFrameLimit();
  }

  // Expose protected state
  get _wsFramesByRequest() {
    return this.wsFramesByRequest;
  }

  get _wsFrameOrder() {
    return this.wsFrameOrder;
  }

  get _wsConnections() {
    return this.wsConnections;
  }

  get _wsConfig() {
    return this.wsConfig;
  }

  set _wsConfig(value: typeof this.wsConfig) {
    this.wsConfig = value;
  }
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createCollector() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  return { getActivePage: vi.fn() } as any;
}

function makeFrame(overrides: Partial<WsFrameRecord> = {}): WsFrameRecord {
  return {
    requestId: 'req-1',
    timestamp: Date.now() / 1000,
    direction: 'sent',
    opcode: 1,
    payloadLength: 5,
    payloadPreview: 'hello',
    payloadSample: 'hello',
    isBinary: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StreamingToolHandlersBase', () => {
  let handler: TestableBase;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new TestableBase(createCollector());
  });

  // -----------------------------------------------------------------------
  // asJson
  // -----------------------------------------------------------------------
  describe('asJson', () => {
    it('wraps a payload into TextToolResponse format', () => {
      const result = handler.callAsJson({ foo: 'bar' });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify({ foo: 'bar' }, null, 2) }],
      });
    });

    it('handles null payload', () => {
      const result = handler.callAsJson(null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parseJson<any>(result)).toBeNull();
    });

    it('handles array payload', () => {
      const result = handler.callAsJson([1, 2, 3]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parseJson<any>(result)).toEqual([1, 2, 3]);
    });

    it('handles nested objects', () => {
      const nested = { a: { b: { c: true } } };
      const result = handler.callAsJson(nested);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parseJson<any>(result)).toEqual(nested);
    });
  });

  // -----------------------------------------------------------------------
  // parseOptionalStringArg
  // -----------------------------------------------------------------------
  describe('parseOptionalStringArg', () => {
    it('returns trimmed non-empty string', () => {
      expect(handler.callParseOptionalStringArg('  hello  ')).toBe('hello');
    });

    it('returns undefined for empty string', () => {
      expect(handler.callParseOptionalStringArg('')).toBeUndefined();
    });

    it('returns undefined for whitespace-only string', () => {
      expect(handler.callParseOptionalStringArg('   ')).toBeUndefined();
    });

    it('returns undefined for non-string values', () => {
      expect(handler.callParseOptionalStringArg(123)).toBeUndefined();
      expect(handler.callParseOptionalStringArg(null)).toBeUndefined();
      expect(handler.callParseOptionalStringArg(undefined)).toBeUndefined();
      expect(handler.callParseOptionalStringArg({})).toBeUndefined();
      expect(handler.callParseOptionalStringArg(true)).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // parseNumberArg
  // -----------------------------------------------------------------------
  describe('parseNumberArg', () => {
    const opts = { defaultValue: 50, min: 0, max: 100 };

    it('returns valid number directly', () => {
      expect(handler.callParseNumberArg(42, opts)).toBe(42);
    });

    it('parses numeric string', () => {
      expect(handler.callParseNumberArg('42', opts)).toBe(42);
    });

    it('parses numeric string with whitespace', () => {
      expect(handler.callParseNumberArg('  42  ', opts)).toBe(42);
    });

    it('returns default for non-numeric string', () => {
      expect(handler.callParseNumberArg('abc', opts)).toBe(50);
    });

    it('returns default for undefined', () => {
      expect(handler.callParseNumberArg(undefined, opts)).toBe(50);
    });

    it('returns default for null', () => {
      expect(handler.callParseNumberArg(null, opts)).toBe(50);
    });

    it('returns default for NaN', () => {
      expect(handler.callParseNumberArg(NaN, opts)).toBe(50);
    });

    it('returns default for Infinity', () => {
      expect(handler.callParseNumberArg(Infinity, opts)).toBe(50);
    });

    it('clamps below min', () => {
      expect(handler.callParseNumberArg(-10, opts)).toBe(0);
    });

    it('clamps above max', () => {
      expect(handler.callParseNumberArg(200, opts)).toBe(100);
    });

    it('truncates when integer option is set', () => {
      expect(handler.callParseNumberArg(42.7, { ...opts, integer: true })).toBe(42);
    });

    it('does not truncate without integer option', () => {
      expect(handler.callParseNumberArg(42.7, opts)).toBe(42.7);
    });

    it('truncates before clamping', () => {
      // 0.9 truncated -> 0, which is >= min 0
      expect(handler.callParseNumberArg(0.9, { ...opts, integer: true })).toBe(0);
    });

    it('handles negative floats with truncation', () => {
      // -0.5 truncated -> -0, clamped to min 0
      const result = handler.callParseNumberArg(-0.5, { ...opts, integer: true });
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(0);
    });
  });

  // -----------------------------------------------------------------------
  // parseWsDirection
  // -----------------------------------------------------------------------
  describe('parseWsDirection', () => {
    it('returns "sent" for "sent"', () => {
      expect(handler.callParseWsDirection('sent')).toBe('sent');
    });

    it('returns "received" for "received"', () => {
      expect(handler.callParseWsDirection('received')).toBe('received');
    });

    it('returns "all" for "all"', () => {
      expect(handler.callParseWsDirection('all')).toBe('all');
    });

    it('defaults to "all" for unrecognized strings', () => {
      expect(handler.callParseWsDirection('both')).toBe('all');
      expect(handler.callParseWsDirection('SENT')).toBe('all');
    });

    it('defaults to "all" for non-string values', () => {
      expect(handler.callParseWsDirection(123)).toBe('all');
      expect(handler.callParseWsDirection(null)).toBe('all');
      expect(handler.callParseWsDirection(undefined)).toBe('all');
    });
  });

  // -----------------------------------------------------------------------
  // compileRegex
  // -----------------------------------------------------------------------
  describe('compileRegex', () => {
    it('compiles a valid regex pattern', () => {
      const result = handler.callCompileRegex('^foo.*bar$');
      expect(result.regex).toBeInstanceOf(RegExp);
      expect(result.error).toBeUndefined();
      expect(result.regex!.test('fooXbar')).toBe(true);
    });

    it('returns error for invalid regex', () => {
      const result = handler.callCompileRegex('[');
      expect(result.regex).toBeUndefined();
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe('string');
    });

    it('returns error for another invalid pattern', () => {
      const result = handler.callCompileRegex('(?<=');
      expect(result.error).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // getWsFrameStats
  // -----------------------------------------------------------------------
  describe('getWsFrameStats', () => {
    it('returns zero stats when no frames exist', () => {
      const stats = handler.callGetWsFrameStats();
      expect(stats).toEqual({ total: 0, sent: 0, received: 0 });
    });

    it('counts sent and received frames correctly', () => {
      handler.callAppendWsFrame('r1', makeFrame({ requestId: 'r1', direction: 'sent' }));
      handler.callAppendWsFrame('r1', makeFrame({ requestId: 'r1', direction: 'sent' }));
      handler.callAppendWsFrame('r1', makeFrame({ requestId: 'r1', direction: 'received' }));

      const stats = handler.callGetWsFrameStats();
      expect(stats).toEqual({ total: 3, sent: 2, received: 1 });
    });
  });

  // -----------------------------------------------------------------------
  // appendWsFrame
  // -----------------------------------------------------------------------
  describe('appendWsFrame', () => {
    it('adds frame to wsFramesByRequest map', () => {
      const frame = makeFrame({ requestId: 'r1' });
      handler.callAppendWsFrame('r1', frame);

      expect(handler._wsFramesByRequest.get('r1')).toHaveLength(1);
      expect(handler._wsFramesByRequest.get('r1')![0]).toBe(frame);
    });

    it('adds frame to wsFrameOrder ring buffer', () => {
      const frame = makeFrame({ requestId: 'r1' });
      handler.callAppendWsFrame('r1', frame);

      expect(handler._wsFrameOrder.length).toBe(1);
      const entries = handler._wsFrameOrder.toArray();
      const entry = entries[0];
      expect(entry).toBeDefined();
      if (!entry) {
        throw new Error('Expected ws frame order entry');
      }
      expect(entry.requestId).toBe('r1');
      expect(entry.frame).toBe(frame);
    });

    it('appends multiple frames to the same requestId bucket', () => {
      handler.callAppendWsFrame('r1', makeFrame({ requestId: 'r1', direction: 'sent' }));
      handler.callAppendWsFrame('r1', makeFrame({ requestId: 'r1', direction: 'received' }));

      expect(handler._wsFramesByRequest.get('r1')).toHaveLength(2);
    });

    it('increments connection framesCount when connection exists', () => {
      handler._wsConnections.set('r1', {
        requestId: 'r1',
        url: 'wss://example.com',
        status: 'open',
        framesCount: 0,
        createdTimestamp: 1,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      } as any);

      handler.callAppendWsFrame('r1', makeFrame({ requestId: 'r1' }));

      expect(handler._wsConnections.get('r1')!.framesCount).toBe(1);
    });

    it('transitions connection from "connecting" to "open" on first frame', () => {
      handler._wsConnections.set('r1', {
        requestId: 'r1',
        url: 'wss://example.com',
        status: 'connecting',
        framesCount: 0,
        createdTimestamp: 1,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      } as any);

      handler.callAppendWsFrame('r1', makeFrame({ requestId: 'r1' }));

      expect(handler._wsConnections.get('r1')!.status).toBe('open');
    });

    it('does not change status if already "open"', () => {
      handler._wsConnections.set('r1', {
        requestId: 'r1',
        url: 'wss://example.com',
        status: 'open',
        framesCount: 0,
        createdTimestamp: 1,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      } as any);

      handler.callAppendWsFrame('r1', makeFrame({ requestId: 'r1' }));

      expect(handler._wsConnections.get('r1')!.status).toBe('open');
    });
  });

  // -----------------------------------------------------------------------
  // enforceWsFrameLimit
  // -----------------------------------------------------------------------
  describe('enforceWsFrameLimit', () => {
    it('does nothing when frame count is within limit', () => {
      handler._wsConfig = { enabled: true, maxFrames: 10 };
      handler.callAppendWsFrame('r1', makeFrame({ requestId: 'r1' }));

      handler.callEnforceWsFrameLimit();
      expect(handler._wsFrameOrder.length).toBe(1);
    });

    it('evicts oldest frames when over the limit', () => {
      handler._wsConfig = { enabled: true, maxFrames: 2 };

      handler.callAppendWsFrame('r1', makeFrame({ requestId: 'r1', timestamp: 1 }));
      handler.callAppendWsFrame('r1', makeFrame({ requestId: 'r1', timestamp: 2 }));
      handler.callAppendWsFrame('r1', makeFrame({ requestId: 'r1', timestamp: 3 }));

      // maxFrames is 2, but the ring buffer capacity was set in constructor (1000 default).
      // enforceWsFrameLimit uses wsConfig.maxFrames to trim.
      expect(handler._wsFrameOrder.length).toBe(2);
    });

    it('removes empty requestId bucket from map after eviction', () => {
      handler._wsConfig = { enabled: true, maxFrames: 1 };

      handler.callAppendWsFrame('old', makeFrame({ requestId: 'old', timestamp: 1 }));
      handler.callAppendWsFrame('new', makeFrame({ requestId: 'new', timestamp: 2 }));

      // 'old' bucket should have been emptied and deleted
      expect(handler._wsFramesByRequest.has('old')).toBe(false);
      expect(handler._wsFramesByRequest.has('new')).toBe(true);
    });

    it('decrements connection framesCount on eviction', () => {
      handler._wsConfig = { enabled: true, maxFrames: 1 };

      handler._wsConnections.set('r1', {
        requestId: 'r1',
        url: 'wss://example.com',
        status: 'open',
        framesCount: 0,
        createdTimestamp: 1,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      } as any);

      handler.callAppendWsFrame('r1', makeFrame({ requestId: 'r1', timestamp: 1 }));
      handler.callAppendWsFrame('r1', makeFrame({ requestId: 'r1', timestamp: 2 }));

      // After two appends with maxFrames=1, one was evicted
      expect(handler._wsConnections.get('r1')!.framesCount).toBe(1);
    });

    it('does not let framesCount go below zero', () => {
      handler._wsConfig = { enabled: true, maxFrames: 1 };

      handler._wsConnections.set('r1', {
        requestId: 'r1',
        url: 'wss://example.com',
        status: 'open',
        framesCount: 0,
        createdTimestamp: 1,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      } as any);

      // Manually set framesCount to 0 before eviction occurs
      handler.callAppendWsFrame('r1', makeFrame({ requestId: 'r1', timestamp: 1 }));
      handler._wsConnections.get('r1')!.framesCount = 0;
      handler.callAppendWsFrame('r1', makeFrame({ requestId: 'r1', timestamp: 2 }));

      expect(handler._wsConnections.get('r1')!.framesCount).toBeGreaterThanOrEqual(0);
    });
  });

  // -----------------------------------------------------------------------
  // Initial state
  // -----------------------------------------------------------------------
  describe('initial state', () => {
    it('starts with empty wsFramesByRequest', () => {
      expect(handler._wsFramesByRequest.size).toBe(0);
    });

    it('starts with empty wsFrameOrder', () => {
      expect(handler._wsFrameOrder.length).toBe(0);
    });

    it('starts with empty wsConnections', () => {
      expect(handler._wsConnections.size).toBe(0);
    });

    it('starts with ws monitoring disabled', () => {
      expect(handler._wsConfig.enabled).toBe(false);
    });

    it('starts with default maxFrames of 1000', () => {
      expect(handler._wsConfig.maxFrames).toBe(1000);
    });
  });
});
