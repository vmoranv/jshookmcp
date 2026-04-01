import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { FrameworkStateHandlers } from '@server/domains/browser/handlers/framework-state';

type EvaluateFn = (pageFunction: any, ...args: any[]) => Promise<any>;

function createHandler(context: {
  document: Record<string, any>;
  window: Record<string, any>;
  createCdpReject?: Error;
  page?: {
    evaluate?: EvaluateFn;
    createCDPSession?: () => Promise<{
      send: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
    }>;
  };
}) {
  const page = {
    evaluate: vi.fn(async (pageFunction: EvaluateFn, ...args: any[]) => {
      const prevWindow = (globalThis as any).window;
      const prevDocument = (globalThis as any).document;
      (globalThis as any).window = context.window;
      (globalThis as any).document = context.document;
      try {
        return await pageFunction(...args);
      } finally {
        (globalThis as any).window = prevWindow;
        (globalThis as any).document = prevDocument;
      }
    }),
    createCDPSession: vi.fn(async () => ({
      send: vi.fn(async () => ({ result: { value: 1 } })),
    })),
  } as any;

  if (context.page?.evaluate) {
    page.evaluate = vi.fn(async (pageFunction: EvaluateFn, ...args: any[]) => {
      const prevWindow = (globalThis as any).window;
      const prevDocument = (globalThis as any).document;
      (globalThis as any).window = context.window;
      (globalThis as any).document = context.document;
      try {
        return await context.page!.evaluate!(pageFunction, ...args);
      } finally {
        (globalThis as any).window = prevWindow;
        (globalThis as any).document = prevDocument;
      }
    }) as any;
  }

  if (context.page?.createCDPSession) {
    page.createCDPSession = vi.fn(context.page.createCDPSession as any) as any;
  }

  if (context.createCdpReject) {
    page.createCDPSession = vi.fn(async () => ({
      send: vi.fn().mockRejectedValue(context.createCdpReject),
    })) as any;
  }

  const handlers = new FrameworkStateHandlers({
    getActivePage: vi.fn(async () => page),
  });

  return { handlers, page };
}

function makeDocument(overrides: Record<string, any> = {}) {
  return {
    body: {},
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
    getElementById: vi.fn(() => null),
    ...overrides,
  };
}

describe('FrameworkStateHandlers runtime coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('extracts React state and Next.js metadata', async () => {
    const childFiber = {
      memoizedState: { memoizedState: { child: true }, next: null },
      type: { name: 'Child' },
      child: null,
      sibling: null,
    };
    const siblingFiber = {
      memoizedState: { queue: { lastRenderedState: { sibling: true } }, next: null },
      type: 'Sibling',
      child: null,
      sibling: null,
    };
    const rootFiber = {
      memoizedState: {
        memoizedState: { count: 1, fn: () => 'ok' },
        next: { queue: { lastRenderedState: { queued: true } }, next: null },
      },
      type: { name: 'App' },
      child: childFiber,
      sibling: siblingFiber,
    };
    const rootEl = { __reactFiber$test: rootFiber };
    const { handlers } = createHandler({
      document: makeDocument({
        body: rootEl,
      }),
      window: {
        __NEXT_DATA__: {
          page: '/home',
          buildId: 'build-1',
          runtimeConfig: { onReady: () => true },
          props: { nested: { ok: true } },
        },
      },
    });

    const parsed = parseJson<any>(
      await handlers.handleFrameworkStateExtract({ framework: 'auto' }),
    );

    expect(parsed.detected).toBe('react');
    expect(parsed.found).toBe(true);
    expect(parsed.states).toHaveLength(3);
    expect(parsed.states[0].component).toBe('App');
    expect(parsed.states[0].state[0].fn).toBe('[Function]');
    expect(parsed.meta.framework).toBe('nextjs');
    expect(parsed.meta.route).toBe('/home');
    expect(parsed.meta.runtimeConfig.onReady).toBe('[Function]');
  });

  it('uses the selector root and serializes deep, truncated, and unserializable React state', async () => {
    const deepState = {
      level1: {
        level2: {
          level3: {
            level4: {
              level5: {
                level6: true,
              },
            },
          },
        },
      },
    };
    const truncatedState = Object.fromEntries(
      Array.from({ length: 32 }, (_, index) => [`k${String(index).padStart(2, '0')}`, index]),
    );
    const unserializableState = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('boom');
        },
      },
    );
    const rootFiber = {
      memoizedState: {
        memoizedState: deepState,
        next: {
          memoizedState: truncatedState,
          next: {
            memoizedState: unserializableState,
            next: null,
          },
        },
      },
      type: { name: 'SelectorApp' },
      child: null,
      sibling: null,
    };
    const rootEl = { __reactFiber$selector: rootFiber };
    const { handlers } = createHandler({
      document: makeDocument({
        body: {},
        querySelector: vi.fn((selector: string) => (selector === '#selected-root' ? rootEl : null)),
      }),
      window: {},
    });

    const parsed = parseJson<any>(
      await handlers.handleFrameworkStateExtract({
        framework: 'react',
        selector: '#selected-root',
      }),
    );

    expect(parsed.detected).toBe('react');
    expect(parsed.found).toBe(true);
    expect(parsed.states).toHaveLength(1);
    expect(parsed.states[0].component).toBe('SelectorApp');
    expect(parsed.states[0].state[0].level1.level2.level3.level4.level5).toBe('[deep]');
    expect(parsed.states[0].state[1].__truncated__).toBe(true);
    expect(parsed.states[0].state[2]).toBe('[unserializable]');
  });

  it('falls back to the body when a selector lookup misses', async () => {
    const rootFiber = {
      memoizedState: { memoizedState: { count: 1 }, next: null },
      type: undefined,
      child: null,
      sibling: null,
    };
    const rootEl = { __reactFiber$body: rootFiber };
    const { handlers } = createHandler({
      document: makeDocument({
        body: rootEl,
        querySelector: vi.fn(() => null),
      }),
      window: {},
    });

    const parsed = parseJson<any>(
      await handlers.handleFrameworkStateExtract({
        framework: 'react',
        selector: '#missing-root',
      }),
    );

    expect(parsed.detected).toBe('react');
    expect(parsed.found).toBe(true);
    expect(parsed.states[0].component).toBe('anonymous');
    expect(parsed.states[0].state[0].count).toBe(1);
  });

  it.each([
    {
      name: 'React internal instance marker',
      bodyKey: '__reactInternalInstance$test',
    },
    {
      name: 'React fiber container marker',
      bodyKey: '__reactFiberContainer$test',
    },
  ])('detects React via %s', async ({ bodyKey }) => {
    const rootFiber = {
      memoizedState: { memoizedState: { count: 1 }, next: null },
      type: undefined,
      child: null,
      sibling: null,
    };
    const { handlers } = createHandler({
      document: makeDocument({
        body: {
          [bodyKey]: rootFiber,
        },
      }),
      window: {},
    });

    const parsed = parseJson<any>(
      await handlers.handleFrameworkStateExtract({ framework: 'auto' }),
    );

    expect(parsed.detected).toBe('react');
    expect(parsed.found).toBe(true);
    expect(parsed.states[0].component).toBe('anonymous');
    expect(parsed.states[0].state[0].count).toBe(1);
  });

  it('extracts Vue 3 state and Nuxt 3 metadata', async () => {
    const childComp = {
      type: { __name: 'Child' },
      setupState: { child: true },
      data: { legacy: 'x' },
      subTree: { children: [] },
    };
    const rootComp = {
      type: { __name: 'Root' },
      setupState: { ready: true },
      data: { count: 2 },
      subTree: { children: [{ component: childComp }] },
    };
    const { handlers } = createHandler({
      document: makeDocument({
        body: { __vueParentComponent: rootComp },
      }),
      window: {
        __NUXT__: {
          config: { api: true },
          state: { loaded: true },
          data: { payload: [1] },
          _errors: [],
        },
      },
    });

    const parsed = parseJson<any>(
      await handlers.handleFrameworkStateExtract({ framework: 'auto' }),
    );

    expect(parsed.detected).toBe('vue3');
    expect(parsed.states[0].component).toBe('Root');
    expect(parsed.states[0].setupState.ready).toBe(true);
    expect(parsed.meta.framework).toBe('nuxt3');
    expect(parsed.meta.config.api).toBe(true);
  });

  it('extracts Vue 2 state and Nuxt 2 metadata', async () => {
    const { handlers } = createHandler({
      document: makeDocument({
        body: {
          __vue__: {
            $options: { name: 'LegacyApp' },
            $data: { items: [1, 2] },
            $children: [
              {
                $options: { name: 'Nested' },
                $data: { flag: true },
                $children: [],
              },
            ],
          },
        },
      }),
      window: {
        __NUXT__: {
          state: { server: true },
          serverRendered: true,
        },
      },
    });

    const parsed = parseJson<any>(
      await handlers.handleFrameworkStateExtract({ framework: 'auto' }),
    );

    expect(parsed.detected).toBe('vue2');
    expect(parsed.states).toHaveLength(2);
    expect(parsed.states[0].component).toBe('LegacyApp');
    expect(parsed.meta.framework).toBe('nuxt2');
    expect(parsed.meta.serverRendered).toBe(true);
  });

  it('extracts Preact state without throwing before root lookup completes', async () => {
    const vnode = {
      __c: {
        state: { count: 3 },
        props: { title: 'Todos' },
        __H: null,
      },
      type: 'TodoList',
      __k: null,
    };
    const { handlers } = createHandler({
      document: makeDocument({
        querySelector: vi.fn((selector: string) =>
          selector === '.preact-root'
            ? {
                __k: [vnode],
              }
            : null,
        ),
      }),
      window: {},
    });

    const parsed = parseJson<any>(
      await handlers.handleFrameworkStateExtract({
        framework: 'preact',
        selector: '.preact-root',
      }),
    );

    expect(parsed.detected).toBe('preact');
    expect(parsed.found).toBe(true);
    expect(parsed.states).toHaveLength(1);
    expect(parsed.states[0].component).toBe('TodoList');
    expect(parsed.states[0].state[0].count).toBe(3);
    expect(parsed.states[0].props.title).toBe('Todos');
  });

  it('extracts Svelte state from DOM candidates', async () => {
    const svelteEl = {
      tagName: 'SECTION',
      $$: {
        ctx: [1, undefined, () => 'skip', { nested: { ok: true } }],
        fragment: {},
      },
      __svelte_meta: { loc: { file: '/src/Comp.svelte' } },
    };
    const { handlers } = createHandler({
      document: makeDocument({
        body: svelteEl,
        querySelectorAll: vi.fn(() => [svelteEl]),
      }),
      window: {},
    });

    const parsed = parseJson<any>(
      await handlers.handleFrameworkStateExtract({ framework: 'auto' }),
    );

    expect(parsed.detected).toBe('svelte');
    expect(parsed.states).toHaveLength(1);
    expect(parsed.states[0].file).toBe('/src/Comp.svelte');
    expect(parsed.states[0].state[0].$0).toBe(1);
    expect(parsed.states[0].state[0].$3.nested.ok).toBe(true);
  });

  it('falls back to the Svelte tag name when no file metadata is present', async () => {
    const svelteEl = {
      tagName: 'ARTICLE',
      $$: {
        ctx: [{ ok: true }],
        fragment: {},
      },
    };
    const { handlers } = createHandler({
      document: makeDocument({
        body: svelteEl,
        querySelectorAll: vi.fn(() => [svelteEl]),
      }),
      window: {},
    });

    const parsed = parseJson<any>(
      await handlers.handleFrameworkStateExtract({ framework: 'auto' }),
    );

    expect(parsed.detected).toBe('svelte');
    expect(parsed.states).toHaveLength(1);
    expect(parsed.states[0].component).toBe('article');
    expect(parsed.states[0].file).toBeUndefined();
  });

  it('extracts Solid state from devtools roots and hydration fallback', async () => {
    const { handlers: devtoolsHandlers } = createHandler({
      document: makeDocument(),
      window: {
        _$DX: {
          roots: {
            a: { name: 'SolidA', value: { n: 1 } },
            b: { state: { n: 2 } },
          },
        },
      },
    });
    const devtoolsParsed = parseJson<any>(
      await devtoolsHandlers.handleFrameworkStateExtract({ framework: 'auto' }),
    );

    expect(devtoolsParsed.detected).toBe('solid');
    expect(devtoolsParsed.states).toHaveLength(2);
    expect(devtoolsParsed.states[1].state[0].n).toBe(2);

    const { handlers: fallbackHandlers } = createHandler({
      document: makeDocument({
        querySelector: vi.fn((selector: string) => (selector === '[data-hk]' ? {} : null)),
      }),
      window: {},
    });
    const fallbackParsed = parseJson<any>(
      await fallbackHandlers.handleFrameworkStateExtract({ framework: 'auto' }),
    );

    expect(fallbackParsed.detected).toBe('solid');
    expect(fallbackParsed.states[0].component).toBe('SolidRoot');
    expect(fallbackParsed.states[0].state[0]._note).toContain('solid-devtools');
  });

  it('extracts Solid state from Map-based devtools roots', async () => {
    const { handlers } = createHandler({
      document: makeDocument(),
      window: {
        _$DX: {
          roots: new Map([['a', { name: 'SolidMap', value: { ok: true } }]]),
        },
      },
    });

    const parsed = parseJson<any>(
      await handlers.handleFrameworkStateExtract({ framework: 'auto' }),
    );

    expect(parsed.detected).toBe('solid');
    expect(parsed.states).toHaveLength(1);
    expect(parsed.states[0].component).toBe('SolidMap');
    expect(parsed.states[0].state[0].ok).toBe(true);
  });

  it('stops Solid root traversal when maxDepth is exceeded', async () => {
    const roots = new Map<string, any>();
    for (let index = 0; index < 12; index++) {
      roots.set(String(index), { name: `Solid${index}`, value: { index } });
    }
    const { handlers } = createHandler({
      document: makeDocument(),
      window: {
        _$DX: {
          roots,
        },
      },
    });

    const parsed = parseJson<any>(
      await handlers.handleFrameworkStateExtract({ framework: 'auto', maxDepth: 1 }),
    );

    expect(parsed.detected).toBe('solid');
    expect(parsed.states).toHaveLength(10);
    expect(parsed.states[0].component).toBe('Solid0');
    expect(parsed.states[9].component).toBe('Solid9');
  });

  it('extracts Solid hydration context when only _$HY is available', async () => {
    const { handlers } = createHandler({
      document: makeDocument(),
      window: {
        _$HY: {
          hydrated: true,
        },
      },
    });

    const parsed = parseJson<any>(
      await handlers.handleFrameworkStateExtract({ framework: 'auto' }),
    );

    expect(parsed.detected).toBe('solid');
    expect(parsed.states).toHaveLength(1);
    expect(parsed.states[0].component).toBe('SolidHydration');
    expect(parsed.states[0].state[0].hydrated).toBe(true);
  });

  it.each([
    {
      name: 'react with no fiber key',
      framework: 'react',
      body: {},
    },
    {
      name: 'vue3 with null component',
      framework: 'vue3',
      body: { __vueParentComponent: null },
    },
    {
      name: 'vue2 with null vm',
      framework: 'vue2',
      body: { __vue__: null },
    },
    {
      name: 'svelte with no candidates',
      framework: 'svelte',
      body: {},
    },
    {
      name: 'solid with no markers',
      framework: 'solid',
      body: {},
    },
  ])('returns empty state when %s', async ({ framework, body }) => {
    const { handlers } = createHandler({
      document: makeDocument({
        body,
      }),
      window: {},
    });

    const parsed = parseJson<any>(await handlers.handleFrameworkStateExtract({ framework }));

    expect(parsed.detected).toBe(framework);
    expect(parsed.found).toBe(false);
    expect(parsed.states).toEqual([]);
  });

  it('returns a prerequisite error when the CDP session is unresponsive', async () => {
    const { handlers } = createHandler({
      document: makeDocument(),
      window: {},
      createCdpReject: new Error('zombie target'),
    });

    const parsed = parseJson<any>(await handlers.handleFrameworkStateExtract({}));

    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('CDP session unresponsive');
  });

  it('returns a timeout error when page evaluation never settles', async () => {
    vi.useFakeTimers();
    const { handlers } = createHandler({
      document: makeDocument(),
      window: {},
      page: {
        evaluate: async () => new Promise(() => {}),
      },
    });

    const promise = handlers.handleFrameworkStateExtract({});
    await vi.advanceTimersByTimeAsync(30_000);
    const parsed = parseJson<any>(await promise);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('page.evaluate timed out');
  });
});
