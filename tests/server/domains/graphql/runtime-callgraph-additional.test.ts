import { beforeEach, describe, expect, it, vi } from 'vitest';

const isSsrfTargetMock = vi.fn(async () => false);

vi.mock('@src/server/domains/network/replay', () => ({
  isSsrfTarget: vi.fn(async () => isSsrfTargetMock()),
}));

import { GraphQLToolHandlersCallGraph } from '@server/domains/graphql/handlers.impl.core.runtime.callgraph';
import type { CallGraphEdge } from '@server/domains/graphql/handlers.impl.core.runtime.shared';

function parseJson(response: unknown) {
  return JSON.parse((response as any).content[0]!.text);
}

describe('GraphQLToolHandlersCallGraph - additional coverage', () => {
  const page = {
    evaluate: vi.fn(),
    evaluateOnNewDocument: vi.fn(),
    setRequestInterception: vi.fn(),
    on: vi.fn(),
  };
  const collector = {
    getActivePage: vi.fn(async () => page),
  } as any;

  let handlers: GraphQLToolHandlersCallGraph;

  beforeEach(() => {
    vi.clearAllMocks();
    isSsrfTargetMock.mockResolvedValue(false);
    handlers = new GraphQLToolHandlersCallGraph(collector);
  });

  // ── page.evaluate callback execution ─────────────────────────────────
  // The page.evaluate callback runs inside the browser context, so we
  // capture the callback and execute it ourselves to cover lines 29-208.

  describe('page.evaluate callback logic', () => {
    it('executes the evaluate callback and processes empty globals', async () => {
      // Simulate a window with no trace data
      page.evaluate.mockImplementationOnce(async (fn: Function, evalArgs: unknown) => {
        // Execute the callback with a mock window that has no data
        const fakeWindow = {};
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(evalArgs);
        } finally {
          if (origWindow !== undefined) {
            Object.defineProperty(globalThis, 'window', {
              value: origWindow,
              writable: true,
              configurable: true,
            });
          }
        }
      });

      const body = parseJson(await handlers.handleCallGraphAnalyze({}));
      expect(body.success).toBe(true);
      expect(body.nodes).toHaveLength(0);
      expect(body.edges).toHaveLength(0);
      expect(body.stats.scannedRecords).toBe(0);
      expect(body.stats.acceptedRecords).toBe(0);
    });

    it('processes __aiHooks records with caller and callee', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, evalArgs: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __aiHooks: {
            fetchHook: [
              { caller: 'main', callee: 'fetchData', stack: '' },
              { caller: 'fetchData', callee: 'parseResponse', stack: '' },
            ],
          },
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(evalArgs);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleCallGraphAnalyze({}));
      expect(body.success).toBe(true);
      expect(body.nodes.length).toBeGreaterThan(0);
      expect(body.edges.length).toBeGreaterThan(0);
      // Verify edges contain the caller->callee relationships
      const edgeSources = body.edges.map((e: CallGraphEdge) => e.source);
      const edgeTargets = body.edges.map((e: CallGraphEdge) => e.target);
      expect(edgeSources).toContain('main');
      expect(edgeTargets).toContain('fetchData');
    });

    it('processes stack trace frames from records', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, evalArgs: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __aiHooks: {
            hook1: [
              {
                callee: 'targetFn',
                stack: `Error
    at targetFn (app.js:10:5)
    at callerFn (app.js:20:10)
    at main (app.js:30:1)`,
              },
            ],
          },
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(evalArgs);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleCallGraphAnalyze({}));
      expect(body.success).toBe(true);
      expect(body.stats.acceptedRecords).toBeGreaterThan(0);
      // Stack frames create edges from caller to callee
      expect(body.edges.length).toBeGreaterThan(0);
    });

    it('processes __functionTraceRecords global array', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, evalArgs: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __functionTraceRecords: [
            { callee: 'doWork', caller: 'init' },
            { functionName: 'compute', from: 'dispatcher' },
          ],
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(evalArgs);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleCallGraphAnalyze({}));
      expect(body.success).toBe(true);
      expect(body.stats.scannedRecords).toBe(2);
      expect(body.stats.acceptedRecords).toBe(2);
    });

    it('processes __functionTracer.records', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, evalArgs: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __functionTracer: {
            records: [
              { fn: 'alpha', parent: 'beta' },
              { name: 'gamma', from: 'delta' },
            ],
          },
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(evalArgs);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleCallGraphAnalyze({}));
      expect(body.success).toBe(true);
      expect(body.stats.scannedRecords).toBe(2);
    });

    it('skips non-array __aiHooks entries', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, evalArgs: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __aiHooks: {
            validHook: [{ caller: 'a', callee: 'b' }],
            invalidHook: 'not an array',
            nullHook: null,
          },
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(evalArgs);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleCallGraphAnalyze({}));
      expect(body.success).toBe(true);
      expect(body.stats.scannedRecords).toBe(1);
    });

    it('skips non-object entries in hook arrays', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, evalArgs: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __aiHooks: {
            hook1: [null, 42, 'string', { caller: 'real', callee: 'entry' }],
          },
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(evalArgs);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleCallGraphAnalyze({}));
      expect(body.success).toBe(true);
      expect(body.stats.scannedRecords).toBe(1);
    });

    it('normalizes empty/whitespace callee names to fallback', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, evalArgs: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __aiHooks: {
            hook1: [
              { callee: '   ', caller: 'main' },
              { callee: '', caller: 'main' },
            ],
          },
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(evalArgs);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleCallGraphAnalyze({}));
      expect(body.success).toBe(true);
      // Empty callee names get fallback name from the hook name
      expect(body.stats.scannedRecords).toBe(2);
    });

    it('deduplicates edges and increments counts', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, evalArgs: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __aiHooks: {
            hook1: [
              { caller: 'funcA', callee: 'funcB' },
              { caller: 'funcA', callee: 'funcB' },
              { caller: 'funcA', callee: 'funcB' },
            ],
          },
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(evalArgs);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleCallGraphAnalyze({}));
      expect(body.success).toBe(true);
      expect(body.edges).toHaveLength(1);
      expect(body.edges[0].count).toBe(3);
    });

    it('skips self-referencing edges (source === target)', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, evalArgs: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __aiHooks: {
            hook1: [{ caller: 'selfRef', callee: 'selfRef' }],
          },
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(evalArgs);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleCallGraphAnalyze({}));
      expect(body.success).toBe(true);
      expect(body.edges).toHaveLength(0);
      // acceptedRecords is 1 because caller && callee is truthy,
      // even though addEdge discards the self-reference
      expect(body.stats.acceptedRecords).toBe(1);
    });

    it('applies filterPattern to include only matching edges', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, evalArgs: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __aiHooks: {
            hook1: [
              { caller: 'fetchUser', callee: 'parseResponse' },
              { caller: 'unrelated', callee: 'otherFn' },
            ],
          },
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(evalArgs);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleCallGraphAnalyze({ filterPattern: '^fetch' }));
      expect(body.success).toBe(true);
      // Only the edge with 'fetchUser' should match
      expect(body.edges).toHaveLength(1);
      expect(body.edges[0].source).toBe('fetchUser');
    });

    it('handles Firefox-style stack traces (function@file)', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, evalArgs: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __aiHooks: {
            hook1: [
              {
                callee: 'targetFn',
                stack: `targetFn@app.js:10:5
callerFn@app.js:20:10`,
              },
            ],
          },
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(evalArgs);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleCallGraphAnalyze({}));
      expect(body.success).toBe(true);
      expect(body.stats.acceptedRecords).toBeGreaterThan(0);
    });

    it('handles single stack frame that differs from callee', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, evalArgs: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __aiHooks: {
            hook1: [
              {
                callee: 'targetFn',
                stack: 'at wrapperFn (app.js:10:5)',
              },
            ],
          },
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(evalArgs);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleCallGraphAnalyze({}));
      expect(body.success).toBe(true);
      // Single frame != callee => edge from frame[0] to callee
      expect(body.edges.length).toBeGreaterThan(0);
    });

    it('handles single stack frame matching callee (no extra edge)', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, evalArgs: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __aiHooks: {
            hook1: [
              {
                callee: 'sameFn',
                caller: 'main',
                stack: 'at sameFn (app.js:10:5)',
              },
            ],
          },
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(evalArgs);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleCallGraphAnalyze({}));
      expect(body.success).toBe(true);
      // caller->callee edge exists, but single frame == callee => no extra edge
      expect(body.stats.acceptedRecords).toBe(1);
    });

    it('handles empty stack string', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, evalArgs: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __aiHooks: {
            hook1: [
              { callee: 'fn1', caller: 'fn2', stack: '' },
              { callee: 'fn3', caller: 'fn4', stack: '   ' },
            ],
          },
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(evalArgs);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleCallGraphAnalyze({}));
      expect(body.success).toBe(true);
      expect(body.stats.scannedRecords).toBe(2);
      expect(body.stats.acceptedRecords).toBe(2);
    });

    it('uses alternate record field names (method, target)', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, evalArgs: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __functionCalls: [
            { method: 'myMethod', from: 'caller1' },
            { target: 'myTarget', parent: 'caller2' },
          ],
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(evalArgs);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleCallGraphAnalyze({}));
      expect(body.success).toBe(true);
      expect(body.stats.scannedRecords).toBe(2);
      expect(body.stats.acceptedRecords).toBe(2);
    });

    it('handles non-string stack values', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, evalArgs: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __callTrace: [
            { callee: 'fn1', caller: 'fn2', stack: 42 },
            { callee: 'fn3', caller: 'fn4', stack: null },
            { callee: 'fn5', caller: 'fn6', stack: undefined },
          ],
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(evalArgs);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleCallGraphAnalyze({}));
      expect(body.success).toBe(true);
      expect(body.stats.scannedRecords).toBe(3);
      expect(body.stats.acceptedRecords).toBe(3); // caller/callee pairs still create edges
    });

    it('handles records with no caller and no stack (callee only uses fallback)', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, evalArgs: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __traceCalls: [{ callee: 'orphanFn' }],
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(evalArgs);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleCallGraphAnalyze({}));
      expect(body.success).toBe(true);
      expect(body.stats.scannedRecords).toBe(1);
      // No caller, no stack => not "used"
      expect(body.stats.acceptedRecords).toBe(0);
    });

    it('respects maxDepth for deep stack traces', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, evalArgs: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __aiHooks: {
            hook1: [
              {
                callee: 'deepTarget',
                stack: `Error
    at level0 (a.js:1:1)
    at level1 (a.js:2:1)
    at level2 (a.js:3:1)
    at level3 (a.js:4:1)
    at level4 (a.js:5:1)
    at level5 (a.js:6:1)`,
              },
            ],
          },
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(evalArgs);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleCallGraphAnalyze({ maxDepth: 2 }));
      expect(body.success).toBe(true);
      // maxDepth=2 limits stack-derived edges to depth of 2
      expect(body.edges.length).toBeGreaterThan(0);
      expect(body.edges.length).toBeLessThanOrEqual(3); // limited by maxDepth
    });

    it('handles __functionTracer that is not an object', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, evalArgs: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __functionTracer: 'not-an-object',
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(evalArgs);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleCallGraphAnalyze({}));
      expect(body.success).toBe(true);
      expect(body.stats.scannedRecords).toBe(0);
    });

    it('handles __functionTracer.records that is not an array', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, evalArgs: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __functionTracer: {
            records: 'not-an-array',
          },
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(evalArgs);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleCallGraphAnalyze({}));
      expect(body.success).toBe(true);
      expect(body.stats.scannedRecords).toBe(0);
    });

    it('sorts nodes by callCount descending and edges by count descending', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, evalArgs: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __aiHooks: {
            hook1: [
              { caller: 'low', callee: 'high' },
              { caller: 'low', callee: 'high' },
              { caller: 'low', callee: 'high' },
              { caller: 'mid', callee: 'high' },
            ],
          },
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(evalArgs);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleCallGraphAnalyze({}));
      expect(body.success).toBe(true);
      // Nodes should be sorted by callCount descending
      for (let i = 1; i < body.nodes.length; i++) {
        expect(body.nodes[i - 1].callCount).toBeGreaterThanOrEqual(body.nodes[i].callCount);
      }
      // Edges should be sorted by count descending
      for (let i = 1; i < body.edges.length; i++) {
        expect(body.edges[i - 1].count).toBeGreaterThanOrEqual(body.edges[i].count);
      }
    });

    it('handles __aiHooks that is falsy', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, evalArgs: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __aiHooks: null,
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(evalArgs);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleCallGraphAnalyze({}));
      expect(body.success).toBe(true);
      expect(body.stats.scannedRecords).toBe(0);
    });

    it('processes stackTrace and trace fields as stack aliases', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, evalArgs: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __functionTracerRecords: [
            {
              callee: 'fn1',
              stackTrace: `at fn1 (a.js:1:1)
at caller1 (a.js:2:1)`,
            },
            {
              callee: 'fn2',
              trace: `at fn2 (b.js:1:1)
at caller2 (b.js:2:1)`,
            },
          ],
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(evalArgs);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleCallGraphAnalyze({}));
      expect(body.success).toBe(true);
      expect(body.stats.scannedRecords).toBe(2);
      expect(body.stats.acceptedRecords).toBe(2);
    });

    it('handles non-numeric callee values via normalization', async () => {
      page.evaluate.mockImplementationOnce(async (fn: Function, evalArgs: unknown) => {
        const fakeWindow: Record<string, unknown> = {
          __aiHooks: {
            hook1: [{ callee: 42, caller: 'main' }],
          },
        };
        const origWindow = globalThis.window;
        try {
          Object.defineProperty(globalThis, 'window', {
            value: fakeWindow,
            writable: true,
            configurable: true,
          });
          return fn(evalArgs);
        } finally {
          Object.defineProperty(globalThis, 'window', {
            value: origWindow,
            writable: true,
            configurable: true,
          });
        }
      });

      const body = parseJson(await handlers.handleCallGraphAnalyze({}));
      expect(body.success).toBe(true);
      // Non-string callee falls back to hook name
      expect(body.stats.scannedRecords).toBe(1);
    });
  });
});
