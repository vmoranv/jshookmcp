import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StreamingToolHandlersSse } from '@server/domains/streaming/handlers.impl.streaming-sse';

describe('StreamingToolHandlersSse Coverage', () => {
  let handler: any;
  let mockCollector: any;
  let mockPage: any;

  beforeEach(() => {
    mockPage = {
      evaluate: vi.fn(),
      evaluateOnNewDocument: vi.fn(),
    };
    mockCollector = {
      getActivePage: vi.fn().mockResolvedValue(mockPage),
    };
    handler = new StreamingToolHandlersSse(mockCollector);
  });

  describe('enableSseInterceptor persistent option', () => {
    it('should call evaluateOnNewDocument when persistent is true', async () => {
      const result = await handler.handleSseMonitorEnable({ persistent: true, maxEvents: 100 });
      expect(mockPage.evaluateOnNewDocument).toHaveBeenCalled();
      const body = JSON.parse(result.content[0].text);
      expect(body.success).toBe(true);
      expect(body.message).toContain('persistent');
    });
  });

  describe('sseInjectionFn and toDataString execution', () => {
    it('should cover sseInjectionFn and toDataString logic', async () => {
      // Mock enough globals for sseInjectionFn to run
      const mockAddEventListener = vi.fn();
      const mockEventSource: any = vi.fn().mockImplementation(function (this: any, url: string) {
        this.url = url;
        this.addEventListener = mockAddEventListener;
        return this;
      });
      mockEventSource.prototype = { addEventListener: mockAddEventListener };
      mockEventSource.CONNECTING = 0;
      mockEventSource.OPEN = 1;
      mockEventSource.CLOSED = 2;

      const mockWindow: any = {
        EventSource: mockEventSource,
        __jshookSSEMonitor: undefined,
      };

      // We intercept the call to evaluate to capture the sseInjectionFn
      let capturedSseInjectionFn: any;
      mockPage.evaluate.mockImplementation((fn: any, _args: any) => {
        capturedSseInjectionFn = fn;
        return {
          success: true,
          message: 'SSE monitor enabled',
          patched: true,
          maxEvents: 100,
          existingEvents: 0,
        };
      });

      await handler.handleSseMonitorEnable({ maxEvents: 100 });
      expect(capturedSseInjectionFn).toBeDefined();

      // Now we call it in our mocked environment
      vi.stubGlobal('window', mockWindow);
      vi.stubGlobal('navigator', { languages: ['en'], userAgent: 'test' });
      vi.stubGlobal('document', {
        createElement: vi.fn().mockReturnValue({ getContext: vi.fn() }),
      });

      try {
        // 1. Test first-time enable
        const result = capturedSseInjectionFn({ maxEvents: 10 });
        expect(result.success).toBe(true);
        expect(mockWindow.__jshookSSEMonitor).toBeDefined();
        expect(mockWindow.EventSource).not.toBe(mockEventSource); // Should be wrapped

        // 2. Test toDataString via WrappedEventSource message event
        const WrappedES = mockWindow.EventSource;
        // We need to make sure OriginalEventSource instances use the mock
        const esInstance = new WrappedES('http://test.com');

        // The wrapped constructor calls OriginalEventSource, which sets addEventListener
        // then it overrides it on the instance.
        // But it also calls originalAddEventListener which is bound to the original ES.

        // Find the 'message' listener added during construction to the ORIGINAL ES
        const messageCall = mockAddEventListener.mock.calls.find((c: any) => c[0] === 'message');
        expect(messageCall).toBeDefined();
        const messageHandler = messageCall[1];

        // Trigger message
        messageHandler({ data: { complex: 'object' }, type: 'message', lastEventId: '123' });

        const state = mockWindow.__jshookSSEMonitor;
        expect(state.events).toHaveLength(1);
        expect(state.events[0].dataPreview).toBe(JSON.stringify({ complex: 'object' }));
        expect(state.events[0].lastEventId).toBe('123');

        // Test long data truncation
        messageHandler({ data: 'a'.repeat(300), type: 'message' });
        expect(state.events[1].dataPreview).toHaveLength(201); // 200 + ellipsis

        // Test null data
        messageHandler({ data: null, type: 'message' });
        expect(state.events[2].dataPreview).toBe('');

        // Test undefined data (toDataString with undefined)
        messageHandler({ data: undefined, type: 'message' });
        expect(state.events[3].dataPreview).toBe('');

        // Test numeric data (toDataString with number)
        messageHandler({ data: 42, type: 'message' });
        expect(state.events[4].dataPreview).toBe('42');

        // Test unserializable object (circular reference)
        const circular: any = {};
        circular.self = circular;
        messageHandler({ data: circular, type: 'message' });
        expect(state.events[5].dataPreview).toBe('[unserializable]');

        // Test disabled state - pushEvent early return (line 100)
        state.enabled = false;
        const countBefore = state.events.length;
        messageHandler({ data: 'should-not-be-added', type: 'message' });
        expect(state.events.length).toBe(countBefore);
        state.enabled = true;

        // Test urlFilter match failure - shouldCapture returns false (line 100)
        state.urlFilterRaw = '^nomatch$';
        messageHandler({ data: 'filtered-out', type: 'message' });
        expect(state.events.length).toBe(countBefore);
        state.urlFilterRaw = undefined;

        // Test maxEvents limit eviction (line 117) - set maxEvents very low
        state.maxEvents = 2;
        state.events = [];
        messageHandler({ data: 'a', type: 'message' });
        messageHandler({ data: 'b', type: 'message' });
        messageHandler({ data: 'c', type: 'message' });
        messageHandler({ data: 'd', type: 'message' });
        expect(state.events.length).toBe(2);
        expect(state.events[0].dataPreview).toBe('c');
        expect(state.events[1].dataPreview).toBe('d');
        state.maxEvents = 100;

        // Test events truncation when events exceed maxEvents on re-enable (line 78)
        // Reset state for this test
        state.events = Array.from({ length: 50 }, (_, i) => ({
          sourceUrl: 'test',
          eventType: 'msg',
          dataPreview: `${i}`,
          dataLength: 1,
          timestamp: i,
          lastEventId: null,
        }));
        state.maxEvents = 10;
        const result2 = capturedSseInjectionFn({ maxEvents: 10 });
        expect(result2.success).toBe(true);
        expect(mockWindow.__jshookSSEMonitor.events.length).toBe(10);

        // Test open event
        const openHandler = mockAddEventListener.mock.calls.find((c: any) => c[0] === 'open')[1];
        openHandler();
        expect(state.sources['http://test.com'].status).toBe('open');

        // Test error event
        const errorHandler = mockAddEventListener.mock.calls.find((c: any) => c[0] === 'error')[1];
        errorHandler();
        expect(state.sources['http://test.com'].status).toBe('error');

        // 3. Test urlFilter
        mockWindow.__jshookSSEMonitor.urlFilterRaw = 'match';
        const _esInstance2 = new WrappedES('http://nomatch.com');
        // Clear calls to find the next one
        mockAddEventListener.mockClear();
        // Constructing esInstance2 should have added listeners again
        // Wait, the wrapped ES constructor is what we just called.

        // Trigger message on esInstance2's listeners
        // We need to get the listeners for this specific instance if possible,
        // but since we cleared mockAddEventListener, we can just look at new calls.
        const _messageCall2 = mockAddEventListener.mock.calls.find((c: any) => c[0] === 'message');
        // Actually esInstance2 construction already called mockAddEventListener
        // Let's just use the logic that pushEvent is called.

        // 4. Test wrapped addEventListener for custom types with function listener
        mockWindow.__jshookSSEMonitor.urlFilterRaw = undefined;
        mockWindow.__jshookSSEMonitor.maxEvents = 10000;
        const customListener = vi.fn();
        esInstance.addEventListener('custom', customListener);
        const wrappedCustomCall = mockAddEventListener.mock.calls.find(
          (c: any) => c[0] === 'custom',
        );
        const wrappedCustomHandler = wrappedCustomCall[1];

        wrappedCustomHandler({ data: 'custom-data', type: 'custom' });
        expect(customListener).toHaveBeenCalled();
        expect(state.events.some((e: any) => e.eventType === 'custom')).toBe(true);

        // 5. Test wrapped addEventListener for custom types with handleEvent listener (line 218)
        const handleEventObj = { handleEvent: vi.fn() };
        mockAddEventListener.mockClear();
        esInstance.addEventListener('custom-obj', handleEventObj);
        const wrappedObjCall = mockAddEventListener.mock.calls.find(
          (c: any) => c[0] === 'custom-obj',
        );
        expect(wrappedObjCall).toBeDefined();
        const wrappedObjHandler = wrappedObjCall[1];

        wrappedObjHandler({ data: 'obj-data', type: 'custom-obj', lastEventId: '' });
        expect(handleEventObj.handleEvent).toHaveBeenCalled();
        expect(state.events.some((e: any) => e.eventType === 'custom-obj')).toBe(true);

        // 6. Test wrapped addEventListener for standard events falls through (line 226)
        // Standard events ('message', 'open', 'error') go through callOriginalAddEventListener directly
        mockAddEventListener.mockClear();
        const standardListener = vi.fn();
        esInstance.addEventListener('message', standardListener);
        // Check that the listener was added directly without wrapping
        const standardCall = mockAddEventListener.mock.calls.find((c: any) => c[0] === 'message');
        expect(standardCall).toBeDefined();
        // The listener should be the original standardListener, not a wrapper
        expect(standardCall[1]).toBe(standardListener);

        // Also test 'open' and 'error' standard event pass-through
        mockAddEventListener.mockClear();
        const openListener = vi.fn();
        esInstance.addEventListener('open', openListener);
        const openCall = mockAddEventListener.mock.calls.find((c: any) => c[0] === 'open');
        expect(openCall).toBeDefined();
        expect(openCall[1]).toBe(openListener);

        mockAddEventListener.mockClear();
        const errorListener = vi.fn();
        esInstance.addEventListener('error', errorListener);
        const errorCall = mockAddEventListener.mock.calls.find((c: any) => c[0] === 'error');
        expect(errorCall).toBeDefined();
        expect(errorCall[1]).toBe(errorListener);

        // 7. Test addEventListener with null listener (line 225 - falls through)
        mockAddEventListener.mockClear();
        esInstance.addEventListener('custom-null', null);
        const nullCall = mockAddEventListener.mock.calls.find((c: any) => c[0] === 'custom-null');
        expect(nullCall).toBeDefined();
        // null listener goes through the standard path (not wrapped)
        expect(nullCall[1]).toBeNull();

        // 8. Test custom event with lastEventId non-empty
        mockAddEventListener.mockClear();
        const customListenerWithId = vi.fn();
        esInstance.addEventListener('custom-with-id', customListenerWithId);
        const customWithIdCall = mockAddEventListener.mock.calls.find(
          (c: any) => c[0] === 'custom-with-id',
        );
        const customWithIdHandler = customWithIdCall[1];

        customWithIdHandler({ data: 'data', type: 'custom-with-id', lastEventId: 'evt-99' });
        expect(customListenerWithId).toHaveBeenCalled();
        const evtWithId = state.events.find((e: any) => e.eventType === 'custom-with-id');
        expect(evtWithId.lastEventId).toBe('evt-99');

        // 9. Test shouldCapture with invalid regex in urlFilterRaw (line 89 catch)
        state.urlFilterRaw = '[invalid-regex';
        state.events = [];
        // Invalid regex should return true (fallback in catch block)
        messageHandler({ data: 'with-bad-regex', type: 'message' });
        expect(state.events.length).toBeGreaterThan(0);
        state.urlFilterRaw = undefined;

        // 10. Test message with empty lastEventId string
        state.events = [];
        messageHandler({ data: 'test', type: 'message', lastEventId: '' });
        expect(state.events[0].lastEventId).toBeNull();

        // 11. Test message with no type (falls back to 'message')
        state.events = [];
        messageHandler({ data: 'no-type', lastEventId: null });
        // type is event.type || 'message', with no type it should be falsy
        expect(state.events.length).toBe(1);

        // 12. Test source not in sources yet for pushEvent (line 120-127 fallback)
        state.events = [];
        delete state.sources['http://new-source.com'];
        // Trigger via open event on a new ES for a new URL
        mockAddEventListener.mockClear();
        const _esInstance3 = new WrappedES('http://new-source.com');
        const openHandler3 = mockAddEventListener.mock.calls.find((c: any) => c[0] === 'open');
        if (openHandler3) {
          openHandler3[1]();
          expect(state.sources['http://new-source.com']).toBeDefined();
        }

        // 13. Test static property copying failure (line 250 catch - immutable static fields)
        // This path is already covered or unreachable in our test env since
        // Object.defineProperty works fine on functions. But let's try to trigger.
        // The try/catch on line 240-252 is for environments where CONNECTING etc are immutable.
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('should handle missing EventSource gracefully in sseInjectionFn', async () => {
      let capturedFn: any;
      mockPage.evaluate.mockImplementation((fn: any) => {
        capturedFn = fn;
        return { success: false };
      });
      await handler.handleSseMonitorEnable({});

      const mockWindowNoES: any = { EventSource: undefined };
      vi.stubGlobal('window', mockWindowNoES);
      try {
        const result = capturedFn({ maxEvents: 100 });
        expect(result.success).toBe(false);
        expect(result.error).toContain('not available');
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe('handleSseGetEvents internal callback logic', () => {
    it('should cover filter and paging logic in getEvents evaluate callback', async () => {
      let capturedFn: any;
      mockPage.evaluate.mockImplementation((fn: any) => {
        capturedFn = fn;
        return {};
      });

      await handler.handleSseGetEvents({});
      expect(capturedFn).toBeDefined();

      const mockState = {
        enabled: true,
        patched: true,
        maxEvents: 100,
        urlFilterRaw: null,
        events: [
          {
            sourceUrl: 'a',
            eventType: 'msg',
            dataPreview: '1',
            dataLength: 1,
            timestamp: 1,
            lastEventId: null,
          },
          {
            sourceUrl: 'b',
            eventType: 'msg',
            dataPreview: '2',
            dataLength: 1,
            timestamp: 2,
            lastEventId: null,
          },
          {
            sourceUrl: 'a',
            eventType: 'other',
            dataPreview: '3',
            dataLength: 1,
            timestamp: 3,
            lastEventId: null,
          },
        ],
        sources: { a: {}, b: {} },
      };

      vi.stubGlobal('window', { __jshookSSEMonitor: mockState });

      try {
        // 1. Test no filters
        let result = capturedFn({ limit: 10, offset: 0 });
        expect(result.success).toBe(true);
        expect(result.events).toHaveLength(3);

        // 2. Test sourceUrl filter
        result = capturedFn({ sourceUrl: 'a', limit: 10, offset: 0 });
        expect(result.events).toHaveLength(2);
        expect(result.events[0].sourceUrl).toBe('a');

        // 3. Test eventType filter
        result = capturedFn({ eventType: 'other', limit: 10, offset: 0 });
        expect(result.events).toHaveLength(1);
        expect(result.events[0].dataPreview).toBe('3');

        // 4. Test paging
        result = capturedFn({ limit: 1, offset: 1 });
        expect(result.events).toHaveLength(1);
        expect(result.events[0].dataPreview).toBe('2');
        expect(result.page.hasMore).toBe(true);
        expect(result.page.nextOffset).toBe(2);

        // 5. Test monitor not enabled
        vi.stubGlobal('window', { __jshookSSEMonitor: undefined });
        result = capturedFn({ limit: 10, offset: 0 });
        expect(result.success).toBe(false);
        expect(result.message).toContain('not enabled');
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});
