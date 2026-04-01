/**
 * Comprehensive branch coverage tests for FrameworkStateHandlers.
 *
 * Branch coverage targets:
 *  - React: stateList.length === 0 (line ~119) — no push to states
 *  - React: sibling fiber traversal (line ~132)
 *  - React: fiber.type as object vs string vs other (line ~121-126)
 *  - Vue3: setupState null, data present (line ~160 — setupState || data truthy via data)
 *  - Vue3: subTree.children null/undefined/not-array (line ~170-176)
 *  - Vue2: $children null/undefined/not-array (line ~207-210)
 *  - Vue2: $options.name missing → 'unknown' (line ~202-205)
 *  - Svelte: only fragment present, stateObj empty (line ~265)
 *  - Svelte: ctx array with function/null/undefined values skipped (line ~253-258)
 *  - Svelte: states.length >= 50 cap (line ~273)
 *  - Solid: roots typeof !== 'object' — skipped (line ~309)
 *  - Solid: Map roots (line ~310)
 *  - Solid: hy && states.length === 0 — SolidHydration (line ~326)
 *  - Solid: maxDepth*10 cap on roots iteration (line ~314)
 *  - Solid: hydration marker fallback; both missing → null states (line ~288-291)
 *  - Preact: hookStates.length > 0 — hook-based components (line ~394)
 *  - Preact: _children alternate key (Preact 10.x) (line ~423)
 *  - Preact: empty rootVNode array (line ~419)
 *  - Preact: __H.__ not an array → no hooks (line ~376)
 *  - Preact: type as function with displayName (line ~387)
 *  - Preact: React marker false-positive guard (line ~346-352)
 *  - Nuxt2: isNuxt3 false (line ~462)
 *  - Next.js: runtimeConfig and props with functions serialized (line ~445-446)
 *  - CDP 3s timeout reject path (line ~34-36)
 *  - page.evaluate 30s timeout reject path (line ~548-552)
 *  - safeSerialize: depth > 4 → '[deep]' (line ~52)
 *  - safeSerialize: array with > 20 elements → slice (line ~57)
 *  - safeSerialize: object with > 30 keys → __truncated__ (line ~63)
 *  - safeSerialize: null/undefined → returned as-is (line ~53)
 *  - safeSerialize: function → '[Function]' (line ~54)
 *  - safeSerialize: primitive non-object → returned as-is (line ~55)
 *  - safeSerialize: try/catch for unserializable objects (line ~70)
 *  - getRootEl: selector found; selector not found → body; id/app/data-reactroot fallbacks (line ~75-85)
 *  - Auto: framework=preact with React markers → overrides to react (line ~497-499)
 *  - Auto: no framework markers → found: false (line ~500-514)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { FrameworkStateHandlers } from '@server/domains/browser/handlers/framework-state';

type EvaluateFn = (pageFunction: unknown, ...args: unknown[]) => Promise<unknown>;

// Helper: inject synthetic window+document into the pageFunction context via globalThis.
// This runs the ACTUAL extraction logic against controlled DOM/Window mocks.
function withContext(
  page: { evaluate: Mock<EvaluateFn> },
  window: Record<string, unknown>,
  document: Record<string, unknown>,
) {
  page.evaluate = vi.fn<EvaluateFn>(async (pageFunction, ...args) => {
    const prevWindow = (globalThis as any)['window'];
    const prevDocument = (globalThis as any)['document'];
    (globalThis as any)['window'] = window;
    (globalThis as any)['document'] = document;
    try {
      return await (pageFunction as Function)(...args);
    } finally {
      (globalThis as any)['window'] = prevWindow;
      (globalThis as any)['document'] = prevDocument;
    }
  }) as Mock<EvaluateFn>;
}

function makeDocument(overrides: Record<string, unknown> = {}) {
  return {
    body: {},
    querySelector: vi.fn((_selector: string) => null),
    querySelectorAll: vi.fn(() => []),
    getElementById: vi.fn(() => null),
    ...overrides,
  };
}

function parseResponseText<T>(
  response: Awaited<ReturnType<FrameworkStateHandlers['handleFrameworkStateExtract']>>,
): T {
  const first = response.content[0];
  expect(first).toBeDefined();
  expect(first?.type).toBe('text');
  if (first?.type !== 'text') throw new Error('Expected text');
  return JSON.parse(first.text) as T;
}

const makeEntry = (i: number) => ({
  memoizedState: { item: i },
  queue: null,
  next: null,
});

const makeEl = (i: number) => ({ tagName: 'DIV', $$: { ctx: [{ n: i }] } });

describe('FrameworkStateHandlers — branch coverage', () => {
  let page: {
    evaluate: Mock<EvaluateFn>;
    createCDPSession: Mock<() => Promise<{ send: Mock<() => Promise<unknown>> }>>;
  };
  let getActivePage: Mock<() => Promise<unknown>>;
  let handlers: FrameworkStateHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    page = {
      evaluate: vi.fn<EvaluateFn>(),
      createCDPSession: vi.fn(async () => ({
        send: vi.fn(async () => ({ result: { value: 1 } })),
      })),
    } as any;
    getActivePage = vi.fn<() => Promise<unknown>>(async () => page);
    handlers = new FrameworkStateHandlers({ getActivePage });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─────────────────────────────────────────────────────────────
  // CDP health-check — 3s timeout / exception paths
  // ─────────────────────────────────────────────────────────────

  describe('CDP health-check — 3s timeout branch', () => {
    it('throws PrerequisiteError when CDP session send never resolves', async () => {
      vi.useFakeTimers();
      const sendMock = vi.fn(() => new Promise<never>(() => {}));
      const page2 = {
        evaluate: vi.fn<EvaluateFn>(async () => ({ detected: 'auto', states: [], found: false })),
        createCDPSession: vi.fn(async () => ({ send: sendMock })),
      } as any;
      const gp2 = vi.fn<() => Promise<unknown>>(async () => page2);
      const h2 = new FrameworkStateHandlers({ getActivePage: gp2 });

      const promise = h2.handleFrameworkStateExtract({});
      await vi.advanceTimersByTimeAsync(3000);
      const result = await promise;

      const parsed = parseResponseText<{ success?: boolean; error?: string }>(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('CDP session unresponsive');
    });

    it('throws PrerequisiteError when createCDPSession throws synchronously', async () => {
      const page2 = {
        evaluate: vi.fn<EvaluateFn>(),
        createCDPSession: vi.fn(async () => {
          throw new Error('no-cdp');
        }),
      } as any;
      const gp2 = vi.fn<() => Promise<unknown>>(async () => page2);
      const h2 = new FrameworkStateHandlers({ getActivePage: gp2 });

      const result = await h2.handleFrameworkStateExtract({});
      const parsed = parseResponseText<{ success?: boolean; error?: string }>(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('CDP session unresponsive');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // page.evaluate 30s timeout
  // ─────────────────────────────────────────────────────────────

  describe('page.evaluate 30s timeout', () => {
    it('returns error when page.evaluate hangs past 30 seconds', async () => {
      vi.useFakeTimers();
      const page2 = {
        evaluate: vi.fn<EvaluateFn>(() => new Promise(() => {})),
        createCDPSession: vi.fn(async () => ({
          send: vi.fn(async () => ({ result: { value: 1 } })),
        })),
      } as any;
      const gp2 = vi.fn<() => Promise<unknown>>(async () => page2);
      const h2 = new FrameworkStateHandlers({ getActivePage: gp2 });

      const promise = h2.handleFrameworkStateExtract({});
      await vi.advanceTimersByTimeAsync(30_000);
      const result = await promise;

      const parsed = parseResponseText<{ success?: boolean; error?: string }>(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('page.evaluate timed out');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // React branches
  // ─────────────────────────────────────────────────────────────

  describe('React — stateList.length === 0 (no push to states)', () => {
    it('adds no component when memoizedState queue has no extractable values', async () => {
      // Fiber has memoizedState but queue/memoizedState are both undefined
      const rootFiber = {
        memoizedState: { next: null },
        type: { name: 'EmptyQueue' },
        child: null,
        sibling: null,
      };
      const rootEl = { __reactFiber$test: rootFiber };
      withContext(page, {}, makeDocument({ body: rootEl }));

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({ framework: 'react' }),
      );

      // stateList stays empty → no component pushed
      expect(parsed.detected).toBe('react');
      expect(parsed.states).toHaveLength(0);
      expect(parsed.found).toBe(false);
    });
  });

  describe('React — sibling fiber traversal', () => {
    it('extracts sibling fiber state after parent', async () => {
      const siblingFiber = {
        memoizedState: {
          memoizedState: { siblingVal: 'sibling' },
          next: null,
        },
        type: 'SiblingComponent',
        child: null,
        sibling: null,
      };
      const parentFiber = {
        memoizedState: {
          memoizedState: { parentVal: 'parent' },
          next: null,
        },
        type: 'Parent',
        child: null,
        sibling: siblingFiber,
      };
      withContext(page, {}, makeDocument({ body: { __reactFiber$test: parentFiber } }));

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({ framework: 'react' }),
      );

      expect(parsed.states).toHaveLength(2);
      expect(parsed.states[0].component).toBe('Parent');
      expect(parsed.states[1].component).toBe('SiblingComponent');
    });
  });

  describe('React — fiber.type as object vs string', () => {
    it('uses type.name when fiber.type is an object with name property', async () => {
      const fiber = {
        memoizedState: { memoizedState: { ok: true }, next: null },
        type: { name: 'NamedObject' },
        child: null,
        sibling: null,
      };
      withContext(page, {}, makeDocument({ body: { __reactFiber$test: fiber } }));

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({ framework: 'react' }),
      );

      expect(parsed.states[0].component).toBe('NamedObject');
    });

    it('uses type as string directly', async () => {
      const fiber = {
        memoizedState: { memoizedState: { ok: true }, next: null },
        type: 'StringType',
        child: null,
        sibling: null,
      };
      withContext(page, {}, makeDocument({ body: { __reactFiber$test: fiber } }));

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({ framework: 'react' }),
      );

      expect(parsed.states[0].component).toBe('StringType');
    });
  });

  describe('React — queue.lastRenderedState path', () => {
    it('extracts state from queue.lastRenderedState when memoizedState is undefined', async () => {
      const fiber = {
        memoizedState: {
          queue: { lastRenderedState: { from: 'queue' } },
          next: null,
          // memoizedState on queue entry is undefined
        },
        type: { name: 'QueueOnly' },
        child: null,
        sibling: null,
      };
      withContext(page, {}, makeDocument({ body: { __reactFiber$test: fiber } }));

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({ framework: 'react' }),
      );

      expect(parsed.states[0].state).toEqual([{ from: 'queue' }]);
    });
  });

  describe('React — while loop guard cap at 20 entries', () => {
    it('caps at 20 memoizedState entries', async () => {
      let tail: any = null;
      for (let i = 24; i >= 0; i--) {
        const entry = makeEntry(i);
        (entry as any).next = tail;
        tail = entry;
      }
      const fiber = {
        memoizedState: tail,
        type: { name: 'ManyStates' },
        child: null,
        sibling: null,
      };
      withContext(page, {}, makeDocument({ body: { __reactFiber$test: fiber } }));

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({ framework: 'react' }),
      );

      expect(parsed.states[0].state).toHaveLength(20);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Vue 3 branches
  // ─────────────────────────────────────────────────────────────

  describe('Vue 3 — setupState null, data present', () => {
    it('extracts component when only data is present (setupState is null)', async () => {
      // setupState=null → safeSerialize(null) returns null (JSON null)
      // null || data → truthy via data → component is pushed
      const comp = {
        type: { __name: 'DataOnly' },
        setupState: null,
        data: { msg: 'from-data' },
        subTree: null,
      };
      // Use selector so getRootEl() returns the element with __vueParentComponent
      withContext(
        page,
        {},
        makeDocument({
          body: {},
          querySelector: vi.fn((selector: string) =>
            selector === '.vue-root' ? { __vueParentComponent: comp } : null,
          ),
        }),
      );

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({ framework: 'vue3', selector: '.vue-root' }),
      );

      expect(parsed.detected).toBe('vue3');
      expect(parsed.states).toHaveLength(1);
      // null values become undefined after JSON round-trip
      expect(parsed.states[0].data.msg).toBe('from-data');
    });
  });

  describe('Vue 3 — subTree.children null', () => {
    it('does not recurse when subTree.children is null', async () => {
      const rootComp = {
        type: { __name: 'Root' },
        setupState: { root: true },
        data: null,
        subTree: { children: null },
      };
      withContext(
        page,
        {},
        makeDocument({
          body: {},
          querySelector: vi.fn((selector: string) =>
            selector === '.vue-root' ? { __vueParentComponent: rootComp } : null,
          ),
        }),
      );

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({ framework: 'vue3', selector: '.vue-root' }),
      );

      expect(parsed.states).toHaveLength(1);
      expect(parsed.states[0].component).toBe('Root');
    });
  });

  describe('Vue 3 — subTree.children not an array', () => {
    it('does not recurse when subTree.children is a non-array value', async () => {
      const rootComp = {
        type: { __name: 'Root' },
        setupState: { root: true },
        data: null,
        subTree: { children: 'not-an-array' },
      };
      withContext(
        page,
        {},
        makeDocument({
          body: {},
          querySelector: vi.fn((selector: string) =>
            selector === '.vue-root' ? { __vueParentComponent: rootComp } : null,
          ),
        }),
      );

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({ framework: 'vue3', selector: '.vue-root' }),
      );

      expect(parsed.states).toHaveLength(1);
    });
  });

  describe('Vue 3 — ctx fallback when setupState undefined', () => {
    it('serializes ctx when setupState is undefined', async () => {
      const comp = {
        type: { __name: 'CtxFallback' },
        setupState: undefined,
        ctx: { value: 'from-ctx' },
        data: null,
        subTree: null,
      };
      withContext(
        page,
        {},
        makeDocument({
          body: {},
          querySelector: vi.fn((selector: string) =>
            selector === '.vue-root' ? { __vueParentComponent: comp } : null,
          ),
        }),
      );

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({ framework: 'vue3', selector: '.vue-root' }),
      );

      expect(parsed.states[0].setupState.value).toBe('from-ctx');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Vue 2 branches
  // ─────────────────────────────────────────────────────────────

  describe('Vue 2 — $children null', () => {
    it('does not recurse when $children is null', async () => {
      const vm = {
        $options: { name: 'NoChildren' },
        $data: { msg: 'no children' },
        $children: null,
      };
      withContext(page, {}, makeDocument({ body: { __vue__: vm } }));

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({ framework: 'vue2' }),
      );

      expect(parsed.states).toHaveLength(1);
      expect(parsed.states[0].component).toBe('NoChildren');
    });
  });

  describe('Vue 2 — $children not an array', () => {
    it('does not recurse when $children is an object', async () => {
      const vm = {
        $options: { name: 'BadChildren' },
        $data: { msg: 'bad children' },
        $children: { not: 'an array' },
      };
      withContext(page, {}, makeDocument({ body: { __vue__: vm } }));

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({ framework: 'vue2' }),
      );

      expect(parsed.states).toHaveLength(1);
    });
  });

  describe('Vue 2 — $options.name missing → unknown', () => {
    it('uses unknown component name when $options.name is absent', async () => {
      const vm = {
        $options: {},
        $data: { x: 1 },
        $children: [],
      };
      withContext(page, {}, makeDocument({ body: { __vue__: vm } }));

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({ framework: 'vue2' }),
      );

      expect(parsed.states[0].component).toBe('unknown');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Svelte branches
  // ─────────────────────────────────────────────────────────────

  describe('Svelte — fragment present, stateObj empty', () => {
    it('pushes state when fragment exists even if stateObj is empty', async () => {
      const svelteEl = {
        tagName: 'DIV',
        $$: { ctx: [], fragment: { p: 1 } },
        __svelte_meta: { loc: { file: 'Test.svelte' } },
      };
      withContext(
        page,
        {},
        makeDocument({
          body: svelteEl,
          querySelectorAll: vi.fn(() => [svelteEl]),
        }),
      );

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({ framework: 'svelte' }),
      );

      expect(parsed.states).toHaveLength(1);
      expect(parsed.states[0].component).toContain('Test.svelte');
    });
  });

  describe('Svelte — ctx array with functions, undefined, null skipped', () => {
    it('skips function/null/undefined values in ctx array', async () => {
      const svelteEl = {
        tagName: 'SPAN',
        $$: {
          ctx: [1, () => 'fn', undefined, { ok: true }, null],
          fragment: null,
        },
      };
      withContext(
        page,
        {},
        makeDocument({
          body: svelteEl,
          querySelectorAll: vi.fn(() => [svelteEl]),
        }),
      );

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({ framework: 'svelte' }),
      );

      // $0=1, $1=undefined (skipped), $2=undefined (skipped), $3={ok:true}, $4=null (skipped)
      // Keys present: $0, $3
      expect(parsed.states[0].state[0].$0).toBe(1);
      expect(parsed.states[0].state[0].$3).toEqual({ ok: true });
    });
  });

  describe('Svelte — states.length >= 50 cap', () => {
    it('caps component count at 50', async () => {
      const manyEls = Array.from({ length: 60 }, (_, i) => makeEl(i));
      withContext(
        page,
        {},
        makeDocument({
          body: manyEls[0],
          querySelectorAll: vi.fn(() => manyEls),
        }),
      );

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({ framework: 'svelte' }),
      );

      expect(parsed.states.length).toBeLessThanOrEqual(50);
    });
  });

  describe('Svelte — tagName fallback when no file metadata', () => {
    it('uses tagName.toLowerCase() as component name', async () => {
      const svelteEl = {
        tagName: 'ARTICLE',
        $$: { ctx: [{ ok: true }], fragment: null },
      };
      withContext(
        page,
        {},
        makeDocument({
          body: svelteEl,
          querySelectorAll: vi.fn(() => [svelteEl]),
        }),
      );

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({ framework: 'svelte' }),
      );

      expect(parsed.states[0].component).toBe('article');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Solid branches
  // ─────────────────────────────────────────────────────────────

  describe('Solid — roots typeof !== object → skipped', () => {
    it('skips dx.roots when it is a primitive', async () => {
      withContext(
        page,
        {
          _$DX: { roots: 'string-not-an-object' },
          _$HY: null,
        },
        makeDocument({ querySelector: vi.fn(() => null) }),
      );

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({ framework: 'solid' }),
      );

      // No dx roots iterated; hy null and no hydration marker → found: false
      expect(parsed.found).toBe(false);
    });
  });

  describe('Solid — Map roots', () => {
    it('iterates Map.values() for devtools roots', async () => {
      withContext(
        page,
        {
          _$DX: { roots: new Map([['k', { name: 'MapRoot', value: { x: 1 } }]]) },
        },
        makeDocument(),
      );

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({ framework: 'solid' }),
      );

      expect(parsed.states).toHaveLength(1);
      expect(parsed.states[0].component).toBe('MapRoot');
    });
  });

  describe('Solid — empty object roots → SolidHydration from hy', () => {
    it('adds SolidHydration when dx roots produce no states but hy is present', async () => {
      withContext(
        page,
        {
          _$DX: { roots: {} },
          _$HY: { rehydrated: true },
        },
        makeDocument(),
      );

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({ framework: 'solid' }),
      );

      expect(parsed.states).toHaveLength(1);
      expect(parsed.states[0].component).toBe('SolidHydration');
      expect(parsed.states[0].state[0].rehydrated).toBe(true);
    });
  });

  describe('Solid — maxDepth * 10 cap on roots iteration', () => {
    it('stops after maxDepth*10 entries when iterating object roots', async () => {
      const rootsObj: Record<string, unknown> = {};
      for (let i = 0; i < 60; i++) {
        rootsObj[`k${i}`] = { name: `C${i}`, value: { i } };
      }
      withContext(page, { _$DX: { roots: rootsObj } }, makeDocument());

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({ framework: 'solid', maxDepth: 1 }),
      );

      // maxDepth=1 → 1*10 = 10 entries max
      expect(parsed.states.length).toBeLessThanOrEqual(10);
    });
  });

  describe('Solid — hydration marker fallback', () => {
    it('uses hydration marker when no dx/hy but [data-hk] exists', async () => {
      withContext(
        page,
        {},
        makeDocument({
          querySelector: vi.fn((selector: string) =>
            selector === '[data-hk]' ? { 'data-hk': '0_0_1' } : null,
          ),
        }),
      );

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({ framework: 'solid' }),
      );

      expect(parsed.states[0].component).toBe('SolidRoot');
      expect(parsed.states[0].state[0]._note).toContain('solid-devtools');
    });
  });

  describe('Solid — no markers at all → found: false', () => {
    it('returns found: false when no dx, no hy, and no hydration marker', async () => {
      withContext(page, {}, makeDocument({ querySelector: vi.fn(() => null) }));

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({ framework: 'solid' }),
      );

      expect(parsed.found).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Preact branches
  // ─────────────────────────────────────────────────────────────

  describe('Preact — hookStates.length > 0 (hook-based components)', () => {
    it('extracts hook state when __H exists with __ list', async () => {
      // Use _children on the selected element (Preact 10.x key, avoids React marker conflict)
      const vnode = {
        _dom: {},
        _children: [
          {
            __c: {
              state: null,
              props: { label: 'test' },
              __H: {
                __: [{ __: 'hook0' }, { __: { count: 42 } }, { _value: 'hook2' }],
              },
            },
            type: 'Functional',
            __k: null,
          },
        ],
      };
      withContext(
        page,
        {},
        makeDocument({
          body: {},
          querySelector: vi.fn((selector: string) => (selector === '.preact-root' ? vnode : null)),
        }),
      );

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({
          framework: 'preact',
          selector: '.preact-root',
        }),
      );

      expect(parsed.detected).toBe('preact');
      expect(parsed.states).toHaveLength(1);
      expect(parsed.states[0].state).toEqual(['hook0', { count: 42 }, 'hook2']);
    });
  });

  describe('Preact — compState used when hookStates is empty', () => {
    it('falls back to compState when __H is empty', async () => {
      const vnode = {
        _dom: {},
        _children: [
          {
            __c: {
              state: { counter: 10 },
              props: null,
              __H: { __: [] },
            },
            type: 'Classy',
            __k: null,
          },
        ],
      };
      withContext(
        page,
        {},
        makeDocument({
          body: {},
          querySelector: vi.fn((selector: string) => (selector === '.preact-root' ? vnode : null)),
        }),
      );

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({
          framework: 'preact',
          selector: '.preact-root',
        }),
      );

      expect(parsed.states).toHaveLength(1);
      expect(parsed.states[0].state).toEqual([{ counter: 10 }]);
    });
  });

  describe('Preact — empty rootVNode array', () => {
    it('returns null states when _children is an empty array', async () => {
      const el = {
        _dom: {},
        _children: [],
      };
      withContext(
        page,
        {},
        makeDocument({
          body: {},
          querySelector: vi.fn((selector: string) => (selector === '.preact-root' ? el : null)),
        }),
      );

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({
          framework: 'preact',
          selector: '.preact-root',
        }),
      );

      expect(parsed.found).toBe(false);
    });
  });

  describe('Preact — _children alternate key (Preact 10.x)', () => {
    it('uses _children when __k is absent (Preact 10.x)', async () => {
      const vnode = {
        _dom: {},
        _children: [
          {
            __c: {
              state: { nested: true },
              props: null,
              __H: null,
            },
            type: 'NestedAlt',
            __k: null,
          },
          {
            __c: {
              state: { val: 99 },
              props: null,
              __H: null,
            },
            type: 'Alt',
            __k: null,
          },
        ],
      };
      withContext(
        page,
        {},
        makeDocument({
          body: {},
          querySelector: vi.fn((selector: string) => (selector === '.preact-root' ? vnode : null)),
        }),
      );

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({
          framework: 'preact',
          selector: '.preact-root',
        }),
      );

      expect(parsed.states).toHaveLength(2);
      expect(parsed.states[0].state).toEqual([{ nested: true }]);
    });
  });

  describe('Preact — __H.__ not an array → no hook states', () => {
    it('does not crash and falls back to compState when __H.__ is not an array', async () => {
      const vnode = {
        _dom: {},
        _children: [
          {
            __c: {
              state: { x: 1 },
              props: null,
              __H: { __: 'not-array' },
            },
            type: 'BadHooks',
            __k: null,
          },
        ],
      };
      withContext(
        page,
        {},
        makeDocument({
          body: {},
          querySelector: vi.fn((selector: string) => (selector === '.preact-root' ? vnode : null)),
        }),
      );

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({
          framework: 'preact',
          selector: '.preact-root',
        }),
      );

      expect(parsed.states).toHaveLength(1);
      expect(parsed.states[0].state).toEqual([{ x: 1 }]);
    });
  });

  describe('Preact — type as function with displayName', () => {
    it('uses displayName from function type', async () => {
      const fn = (() => {}) as unknown as { displayName?: string; name?: string };
      fn.displayName = 'NamedFunction';
      const vnode = {
        _dom: {},
        _children: [
          {
            __c: {
              state: { ok: true },
              props: null,
              __H: null,
            },
            type: fn,
            __k: null,
          },
        ],
      };
      withContext(
        page,
        {},
        makeDocument({
          body: {},
          querySelector: vi.fn((selector: string) => (selector === '.preact-root' ? vnode : null)),
        }),
      );

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({
          framework: 'preact',
          selector: '.preact-root',
        }),
      );

      expect(parsed.states[0].component).toBe('NamedFunction');
    });
  });

  describe('Preact — React marker false-positive guard', () => {
    it('skips Preact extraction when React fiber markers are present', async () => {
      // Element has both __reactFiber$xxx and _children
      const el = {
        __reactFiber$test: {
          memoizedState: { memoizedState: { x: 1 }, next: null },
          type: 'R',
          child: null,
          sibling: null,
        },
        _children: [
          { __c: { state: { preact: true }, props: null, __H: null }, type: 'P', __k: null },
        ],
      };
      withContext(
        page,
        {},
        makeDocument({
          body: {},
          querySelector: vi.fn((selector: string) => (selector === '.both' ? el : null)),
        }),
      );

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({ framework: 'preact', selector: '.both' }),
      );

      // React markers detected → Preact skipped → found: false (React not in page.evaluate result)
      expect(parsed.detected).toBe('react');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Meta-framework branches
  // ─────────────────────────────────────────────────────────────

  describe('Next.js — runtimeConfig and props functions serialized to [Function]', () => {
    it('converts functions in runtimeConfig and props to [Function]', async () => {
      withContext(
        page,
        {
          __NEXT_DATA__: {
            page: '/page',
            buildId: 'build1',
            runtimeConfig: { fn: () => 'ok' },
            props: { onClick: () => {} },
          },
        },
        makeDocument({ body: { __reactFiber$root: {} } }),
      );

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({ framework: 'auto' }),
      );

      expect(parsed.meta.framework).toBe('nextjs');
      expect(parsed.meta.route).toBe('/page');
      expect(parsed.meta.runtimeConfig.fn).toBe('[Function]');
      expect(parsed.meta.props.onClick).toBe('[Function]');
    });
  });

  describe('Nuxt 2 — isNuxt3 false (no config, no _errors)', () => {
    it('returns nuxt2 framework metadata when __NUXT__ lacks config and _errors', async () => {
      withContext(
        page,
        {
          __NEXT_DATA__: null,
          __NUXT__: {
            state: { data: 'nuxt2' },
            serverRendered: true,
            // No config, no _errors → isNuxt3 = false
          },
        },
        makeDocument({ body: { __vue__: {} } }),
      );

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({ framework: 'auto' }),
      );

      expect(parsed.meta.framework).toBe('nuxt2');
      expect(parsed.meta.serverRendered).toBe(true);
    });
  });

  describe('Meta — omitted when no Next.js or Nuxt data', () => {
    it('does not include meta when no meta-framework detected', async () => {
      withContext(page, {}, makeDocument({ body: {} }));

      const result = await handlers.handleFrameworkStateExtract({ framework: 'auto' });
      const text = parseResponseText<any>(result);

      expect(text.meta).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Auto-detection branches
  // ─────────────────────────────────────────────────────────────

  describe('Auto — framework=preact overridden to react by React markers', () => {
    it('overrides preact to react when __reactFiber$ is on the element', async () => {
      const fiber = {
        memoizedState: { memoizedState: { x: 1 }, next: null },
        type: { name: 'App' },
        child: null,
        sibling: null,
      };
      withContext(
        page,
        {},
        makeDocument({
          body: {},
          querySelector: vi.fn((selector: string) =>
            selector === '.root' ? { __reactFiber$root: fiber, __k: [{ __c: {} }] } : null,
          ),
        }),
      );

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({ framework: 'preact', selector: '.root' }),
      );

      // Even though preact was requested, React markers force detection to 'react'
      expect(parsed.detected).toBe('react');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // safeSerialize branches
  // ─────────────────────────────────────────────────────────────

  describe('safeSerialize — depth > 4 capped to [deep]', () => {
    it('returns [deep] for objects exceeding depth 4', async () => {
      // Build object nested 6 levels deep
      let deep: unknown = { val: 1 };
      for (let i = 0; i < 6; i++) {
        deep = { nested: deep };
      }
      const fiber = {
        memoizedState: { memoizedState: deep, next: null },
        type: { name: 'Deep' },
        child: null,
        sibling: null,
      };
      withContext(page, {}, makeDocument({ body: { __reactFiber$root: fiber } }));

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({ framework: 'react' }),
      );

      // At depth 5: safeSerialize returns '[deep]'
      expect(parsed.states[0].state[0].nested.nested.nested.nested.nested).toBe('[deep]');
    });
  });

  describe('safeSerialize — array slice to 20 elements', () => {
    it('caps array elements at 20', async () => {
      const fiber = {
        memoizedState: {
          memoizedState: Array.from({ length: 30 }, (_, i) => i),
          next: null,
        },
        type: { name: 'BigArray' },
        child: null,
        sibling: null,
      };
      withContext(page, {}, makeDocument({ body: { __reactFiber$root: fiber } }));

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({ framework: 'react' }),
      );

      expect(parsed.states[0].state[0]).toHaveLength(20);
    });
  });

  describe('safeSerialize — object truncated at 30 keys', () => {
    it('sets __truncated__ after processing 30 keys', async () => {
      const largeObj: Record<string, unknown> = {};
      for (let i = 0; i < 35; i++) {
        largeObj[`k${i}`] = i;
      }
      const fiber = {
        memoizedState: { memoizedState: largeObj, next: null },
        type: { name: 'Large' },
        child: null,
        sibling: null,
      };
      withContext(page, {}, makeDocument({ body: { __reactFiber$root: fiber } }));

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({ framework: 'react' }),
      );

      expect(parsed.states[0].state[0].__truncated__).toBe(true);
      // 31 actual keys + __truncated__ = 32
      expect(Object.keys(parsed.states[0].state[0])).toHaveLength(32);
    });
  });

  describe('safeSerialize — function returns [Function]', () => {
    it('converts function values to [Function]', async () => {
      const fiber = {
        memoizedState: {
          memoizedState: { handler: () => 'fn' },
          next: null,
        },
        type: { name: 'FnVal' },
        child: null,
        sibling: null,
      };
      withContext(page, {}, makeDocument({ body: { __reactFiber$root: fiber } }));

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({ framework: 'react' }),
      );

      expect(parsed.states[0].state[0].handler).toBe('[Function]');
    });
  });

  describe('safeSerialize — primitive non-object returned as-is', () => {
    it('returns string/number/boolean without wrapping', async () => {
      const fiber = {
        memoizedState: { memoizedState: 'string', next: null },
        type: { name: 'Prim' },
        child: null,
        sibling: null,
      };
      withContext(page, {}, makeDocument({ body: { __reactFiber$root: fiber } }));

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({ framework: 'react' }),
      );

      expect(parsed.states[0].state[0]).toBe('string');
    });
  });

  describe('safeSerialize — try/catch for unserializable objects', () => {
    it('returns [unserializable] when Object.keys throws', async () => {
      const unserializable = new Proxy(
        {},
        {
          ownKeys() {
            throw new Error('blocked');
          },
        },
      );
      const fiber = {
        memoizedState: { memoizedState: unserializable, next: null },
        type: { name: 'Bad' },
        child: null,
        sibling: null,
      };
      withContext(page, {}, makeDocument({ body: { __reactFiber$root: fiber } }));

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({ framework: 'react' }),
      );

      expect(parsed.states[0].state[0]).toBe('[unserializable]');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // getRootEl fallback chain
  // ─────────────────────────────────────────────────────────────

  describe('getRootEl — #root fallback', () => {
    it('uses #root element when present', async () => {
      const fiber = {
        memoizedState: { memoizedState: { v: 1 }, next: null },
        type: { name: 'App' },
        child: null,
        sibling: null,
      };
      withContext(
        page,
        {},
        makeDocument({
          body: {},
          getElementById: vi.fn((id: string) =>
            id === 'root' ? { __reactFiber$root: fiber } : null,
          ),
        }),
      );

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({ framework: 'react' }),
      );

      expect(parsed.found).toBe(true);
    });
  });

  describe('getRootEl — selector not found → body fallback', () => {
    it('uses document.body when selector misses and no id/app/data-reactroot', async () => {
      const fiber = {
        memoizedState: { memoizedState: { from: 'body' }, next: null },
        type: { name: 'BodyApp' },
        child: null,
        sibling: null,
      };
      withContext(
        page,
        {},
        makeDocument({
          body: { __reactFiber$body: fiber },
          querySelector: vi.fn(() => null),
          getElementById: vi.fn(() => null),
        }),
      );

      const parsed = parseResponseText<any>(
        await handlers.handleFrameworkStateExtract({ framework: 'react', selector: '#missing' }),
      );

      expect(parsed.states[0].component).toBe('BodyApp');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Error paths
  // ─────────────────────────────────────────────────────────────

  describe('Error — getActivePage rejects with non-Error value', () => {
    it('serializes Symbol rejection as error string', async () => {
      getActivePage.mockRejectedValueOnce(Symbol('unexpected'));
      const h2 = new FrameworkStateHandlers({ getActivePage });

      const result = await h2.handleFrameworkStateExtract({});
      const parsed = parseResponseText<{ success: boolean; error: string }>(result);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toBe('Symbol(unexpected)');
    });
  });
});
