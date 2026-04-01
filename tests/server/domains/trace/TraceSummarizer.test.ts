import { describe, it, expect } from 'vitest';
import {
  summarizeEvents,
  summarizeMemoryDeltas,
  extractKeyMoments,
  type TraceEvent,
  type MemoryDelta,
} from '@server/domains/trace/TraceSummarizer';

describe('TraceSummarizer', () => {
  // ── summarizeEvents ──

  describe('summarizeEvents', () => {
    it('returns empty summary for empty input', () => {
      const summaryBalanced = summarizeEvents([], 'balanced');
      expect(summaryBalanced.totalEvents).toBe(0);
      expect(summaryBalanced.keyMoments).toEqual([]);

      const summaryCompact = summarizeEvents([], 'compact');
      expect(summaryCompact.keyMoments).toBeUndefined();
    });

    it('aggregates events by category', () => {
      const events: TraceEvent[] = [
        { timestamp: 100, category: 'debugger', eventType: 'Debugger.paused' },
        { timestamp: 200, category: 'debugger', eventType: 'Debugger.resumed' },
        { timestamp: 300, category: 'network', eventType: 'Network.requestWillBeSent' },
        { timestamp: 400, category: 'debugger', eventType: 'Debugger.paused' },
      ];

      const summary = summarizeEvents(events, 'compact');

      expect(summary.totalEvents).toBe(4);
      expect(summary.timeRange).toEqual({ start: 100, end: 400, durationMs: 300 });
      expect(summary.categories).toHaveLength(2);

      // Debugger should be first (count 3 > count 1)
      expect(summary.categories[0]!.category).toBe('debugger');
      expect(summary.categories[0]!.count).toBe(3);
      expect(summary.categories[1]!.category).toBe('network');
      expect(summary.categories[1]!.count).toBe(1);
    });

    it('compact mode does not include keyMoments', () => {
      const events: TraceEvent[] = [
        { timestamp: 100, category: 'debugger', eventType: 'Debugger.paused' },
      ];
      const summary = summarizeEvents(events, 'compact');
      expect(summary.keyMoments).toBeUndefined();
    });

    it('balanced mode includes keyMoments', () => {
      const events: TraceEvent[] = [
        {
          timestamp: 100,
          category: 'debugger',
          eventType: 'Debugger.paused',
          scriptId: 'script_1',
          lineNumber: 42,
        },
        { timestamp: 200, category: 'runtime', eventType: 'Runtime.exceptionThrown' },
      ];
      const summary = summarizeEvents(events, 'balanced');
      expect(summary.keyMoments).toBeDefined();
      expect(summary.keyMoments!.length).toBe(2);
      expect(summary.keyMoments![0]!.type).toBe('breakpoint');
      expect(summary.keyMoments![1]!.type).toBe('exception');
    });

    it('topEventTypes is limited to 5 entries per category', () => {
      const events: TraceEvent[] = Array.from({ length: 20 }, (_, i) => ({
        timestamp: i * 100,
        category: 'test',
        eventType: `event_type_${i}`,
      }));

      const summary = summarizeEvents(events, 'compact');
      expect(summary.categories[0]!.topEventTypes.length).toBeLessThanOrEqual(5);
    });
  });

  // ── extractKeyMoments ──

  describe('extractKeyMoments', () => {
    it('extracts breakpoint events with optional fields', () => {
      const events: TraceEvent[] = [
        {
          timestamp: 100,
          category: 'debugger',
          eventType: 'Debugger.paused',
          scriptId: 'main.js',
          lineNumber: 10,
        },
        {
          timestamp: 200,
          category: 'debugger',
          eventType: 'Debugger.paused',
        },
        {
          timestamp: 300,
          category: 'debugger',
          eventType: 'Debugger.paused',
          scriptId: 'no_line.js',
        },
        {
          timestamp: 400,
          category: 'debugger',
          eventType: 'Debugger.paused',
          lineNumber: 42,
        },
      ];
      const moments = extractKeyMoments(events);
      expect(moments).toHaveLength(4);
      expect(moments[0]!.type).toBe('breakpoint');
      expect(moments[0]!.description).toBe('Debugger paused at script main.js:10');
      expect(moments[1]!.description).toBe('Debugger paused');
      expect(moments[2]!.description).toBe('Debugger paused at script no_line.js');
      expect(moments[3]!.description).toBe('Debugger paused:42');
    });

    it('extracts network completion events', () => {
      const events: TraceEvent[] = [
        { timestamp: 200, category: 'network', eventType: 'Network.loadingFinished' },
      ];
      const moments = extractKeyMoments(events);
      expect(moments).toHaveLength(1);
      expect(moments[0]!.type).toBe('network_complete');
    });

    it('extracts exception events', () => {
      const events: TraceEvent[] = [
        { timestamp: 300, category: 'runtime', eventType: 'Runtime.exceptionThrown' },
      ];
      const moments = extractKeyMoments(events);
      expect(moments).toHaveLength(1);
      expect(moments[0]!.type).toBe('exception');
    });

    it('extracts navigation events', () => {
      const events: TraceEvent[] = [
        { timestamp: 400, category: 'page', eventType: 'Page.frameNavigated' },
        { timestamp: 500, category: 'page', eventType: 'Page.navigatedWithinDocument' },
      ];
      const moments = extractKeyMoments(events);
      expect(moments).toHaveLength(2);
      expect(moments.every((m) => m.type === 'navigation')).toBe(true);
    });

    it('ignores non-key events', () => {
      const events: TraceEvent[] = [
        { timestamp: 100, category: 'runtime', eventType: 'Runtime.consoleAPICalled' },
        { timestamp: 200, category: 'debugger', eventType: 'Debugger.scriptParsed' },
      ];
      const moments = extractKeyMoments(events);
      expect(moments).toHaveLength(0);
    });
  });

  // ── summarizeMemoryDeltas ──

  describe('summarizeMemoryDeltas', () => {
    it('returns empty summary for empty input', () => {
      const summary = summarizeMemoryDeltas([]);
      expect(summary.totalDeltas).toBe(0);
      expect(summary.uniqueAddresses).toBe(0);
      expect(summary.anomalies).toEqual([]);
      expect(summary.topAddresses).toEqual([]);
    });

    it('counts unique addresses and total deltas', () => {
      const deltas: MemoryDelta[] = [
        {
          timestamp: 100,
          address: '0x1000',
          oldValue: '0',
          newValue: '1',
          size: 4,
          valueType: 'int32',
        },
        {
          timestamp: 200,
          address: '0x1000',
          oldValue: '1',
          newValue: '2',
          size: 4,
          valueType: 'int32',
        },
        {
          timestamp: 300,
          address: '0x2000',
          oldValue: '0',
          newValue: '5',
          size: 4,
          valueType: 'int32',
        },
      ];

      const summary = summarizeMemoryDeltas(deltas);
      expect(summary.totalDeltas).toBe(3);
      expect(summary.uniqueAddresses).toBe(2);
    });

    it('sorts topAddresses by write count descending', () => {
      const deltas: MemoryDelta[] = [
        {
          timestamp: 100,
          address: '0x1000',
          oldValue: '0',
          newValue: '1',
          size: 4,
          valueType: 'int32',
        },
        {
          timestamp: 200,
          address: '0x2000',
          oldValue: '0',
          newValue: '1',
          size: 4,
          valueType: 'int32',
        },
        {
          timestamp: 300,
          address: '0x2000',
          oldValue: '1',
          newValue: '2',
          size: 4,
          valueType: 'int32',
        },
        {
          timestamp: 400,
          address: '0x2000',
          oldValue: '2',
          newValue: '3',
          size: 4,
          valueType: 'int32',
        },
      ];

      const summary = summarizeMemoryDeltas(deltas);
      expect(summary.topAddresses[0]!.address).toBe('0x2000');
      expect(summary.topAddresses[0]!.writeCount).toBe(3);
    });

    it('detects anomalies (>3× mean write count)', () => {
      // 4 addresses, 13 total writes -> mean = 3.25
      // anomaly threshold = 9.75
      const deltas: MemoryDelta[] = [
        // 0x1000: 1 write (normal)
        {
          timestamp: 100,
          address: '0x1000',
          oldValue: '0',
          newValue: '1',
          size: 4,
          valueType: 'int32',
        },
        // 0x2000: 1 write (normal)
        {
          timestamp: 200,
          address: '0x2000',
          oldValue: '0',
          newValue: '1',
          size: 4,
          valueType: 'int32',
        },
        // 0x3000: 1 write (normal)
        {
          timestamp: 300,
          address: '0x3000',
          oldValue: '0',
          newValue: '1',
          size: 4,
          valueType: 'int32',
        },
        // 0x4000: 10 writes (anomaly: 10 > 9.75 = 3.25 × 3)
        ...Array.from({ length: 10 }, (_, i) => ({
          timestamp: 400 + i,
          address: '0x4000',
          oldValue: String(i),
          newValue: String(i + 1),
          size: 4,
          valueType: 'int32',
        })),
      ];

      const summary = summarizeMemoryDeltas(deltas);
      expect(summary.anomalies.length).toBeGreaterThan(0);
      expect(summary.anomalies[0]!.address).toBe('0x4000');
      expect(summary.anomalies[0]!.writeCount).toBe(10);
    });
  });
});
