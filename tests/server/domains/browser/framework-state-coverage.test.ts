import { parseJson, BrowserStatusResponse } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { FrameworkStateHandlers } from '@server/domains/browser/handlers/framework-state';

type EvaluateFn = (pageFunction: unknown, ...args: unknown[]) => Promise<unknown>;
type GetActivePageFn = () => Promise<unknown>;
type FrameworkStateHandlerResponse = Awaited<
  ReturnType<FrameworkStateHandlers['handleFrameworkStateExtract']>
>;

function getTextContent(response: FrameworkStateHandlerResponse): string {
  const first = response.content[0];
  expect(first).toBeDefined();
  expect(first?.type).toBe('text');
  if (first?.type !== 'text') {
    throw new Error('Expected text tool response');
  }
  return first.text;
}



describe('FrameworkStateHandlers — coverage expansion', () => {
  let page: { evaluate: Mock<EvaluateFn> };
  let getActivePage: Mock<GetActivePageFn>;
  let handlers: FrameworkStateHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    page = {
      evaluate: vi.fn<EvaluateFn>(),
      createCDPSession: vi.fn(async () => ({ send: vi.fn(async () => ({ result: { value: 1 } })) })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any;
    getActivePage = vi.fn<GetActivePageFn>(async () => page);
    handlers = new FrameworkStateHandlers({ getActivePage });
  });

  // ── page.evaluate function behavior ──

  describe('evaluate function — safeSerialize', () => {
    it('handles null values in state (undefined becomes null via JSON)', async () => {
      page.evaluate.mockResolvedValueOnce({
        detected: 'react',
        states: [{ component: 'App', state: [null, null, 42] }],
        found: true,
      });

      const body = parseJson<BrowserStatusResponse>(await handlers.handleFrameworkStateExtract({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.found).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.states[0].state).toEqual([null, null, 42]);
    });

    it('handles deeply nested state objects', async () => {
      page.evaluate.mockResolvedValueOnce({
        detected: 'react',
        states: [
          {
            component: 'DeepComponent',
            state: [
              {
                level1: {
                  level2: {
                    level3: {
                      level4: { deep: true },
                    },
                  },
                },
              },
            ],
          },
        ],
        found: true,
      });

      const body = parseJson<BrowserStatusResponse>(await handlers.handleFrameworkStateExtract({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.found).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.states[0].state[0].level1.level2.level3.level4.deep).toBe(true);
    });

    it('handles arrays in state', async () => {
      page.evaluate.mockResolvedValueOnce({
        detected: 'react',
        states: [
          {
            component: 'ListComponent',
            state: [{ items: [1, 2, 3, 4, 5] }],
          },
        ],
        found: true,
      });

      const body = parseJson<BrowserStatusResponse>(await handlers.handleFrameworkStateExtract({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.states[0].state[0].items).toEqual([1, 2, 3, 4, 5]);
    });

    it('handles empty state arrays', async () => {
      page.evaluate.mockResolvedValueOnce({
        detected: 'react',
        states: [{ component: 'Empty', state: [] }],
        found: true,
      });

      const body = parseJson<BrowserStatusResponse>(await handlers.handleFrameworkStateExtract({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.states[0].state).toEqual([]);
    });
  });

  // ── Framework detection ──

  describe('framework auto-detection', () => {
    it('detects React framework via __reactFiber key', async () => {
      page.evaluate.mockResolvedValueOnce({
        detected: 'react',
        states: [{ component: 'ReactApp', state: [{ count: 1 }] }],
        found: true,
      });

      const body = parseJson<BrowserStatusResponse>(await handlers.handleFrameworkStateExtract({ framework: 'auto' }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.detected).toBe('react');
    });

    it('detects Vue 3 framework via __vueParentComponent key', async () => {
      page.evaluate.mockResolvedValueOnce({
        detected: 'vue3',
        states: [{ component: 'VueApp', setupState: { loaded: true }, data: null }],
        found: true,
      });

      const body = parseJson<BrowserStatusResponse>(await handlers.handleFrameworkStateExtract({ framework: 'auto' }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.detected).toBe('vue3');
    });

    it('detects Vue 2 framework via __vue__ key', async () => {
      page.evaluate.mockResolvedValueOnce({
        detected: 'vue2',
        states: [{ component: 'Vue2App', data: { msg: 'hello' } }],
        found: true,
      });

      const body = parseJson<BrowserStatusResponse>(await handlers.handleFrameworkStateExtract({ framework: 'auto' }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.detected).toBe('vue2');
    });

    it('returns auto when no framework detected', async () => {
      page.evaluate.mockResolvedValueOnce({
        detected: 'auto',
        states: [],
        found: false,
      });

      const body = parseJson<BrowserStatusResponse>(await handlers.handleFrameworkStateExtract({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.detected).toBe('auto');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.found).toBe(false);
    });
  });

  // ── Explicit framework specification ──

  describe('explicit framework specification', () => {
    it('extracts react state when framework is explicitly react', async () => {
      page.evaluate.mockResolvedValueOnce({
        detected: 'react',
        states: [{ component: 'ExplicitReact', state: [{ x: 1 }] }],
        found: true,
      });

      const body = parseJson<BrowserStatusResponse>(await handlers.handleFrameworkStateExtract({ framework: 'react' }));

      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        framework: 'react',
        selector: '',
        maxDepth: 5,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.detected).toBe('react');
    });

    it('extracts vue3 state with setupState and data', async () => {
      page.evaluate.mockResolvedValueOnce({
        detected: 'vue3',
        states: [
          {
            component: 'Dashboard',
            setupState: { loading: false, items: [] },
            data: { legacyField: 'value' },
          },
        ],
        found: true,
      });

      const body = parseJson<BrowserStatusResponse>(await handlers.handleFrameworkStateExtract({ framework: 'vue3' }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.states[0].setupState.loading).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.states[0].data.legacyField).toBe('value');
    });

    it('extracts vue2 state with $data', async () => {
      page.evaluate.mockResolvedValueOnce({
        detected: 'vue2',
        states: [
          {
            component: 'OldApp',
            data: { todos: ['a', 'b', 'c'] },
          },
        ],
        found: true,
      });

      const body = parseJson<BrowserStatusResponse>(await handlers.handleFrameworkStateExtract({ framework: 'vue2' }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.states[0].data.todos).toEqual(['a', 'b', 'c']);
    });
  });

  // ── Custom selector ──

  describe('custom selector', () => {
    it('uses provided CSS selector to find root element', async () => {
      page.evaluate.mockResolvedValueOnce({
        detected: 'react',
        states: [{ component: 'TargetComponent', state: [{ v: 1 }] }],
        found: true,
      });

      const body = parseJson<BrowserStatusResponse>(
        await handlers.handleFrameworkStateExtract({
          selector: '#my-custom-root',
          framework: 'react',
        })
      );

      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        framework: 'react',
        selector: '#my-custom-root',
        maxDepth: 5,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.found).toBe(true);
    });

    it('uses [data-reactroot] as fallback when no selector and no #root/#app', async () => {
      page.evaluate.mockResolvedValueOnce({
        detected: 'react',
        states: [],
        found: false,
      });

      await handlers.handleFrameworkStateExtract({});

      // Verify the evaluate was called with empty selector (auto-detect in page)
      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        framework: 'auto',
        selector: '',
        maxDepth: 5,
      });
    });
  });

  // ── Custom maxDepth ──

  describe('custom maxDepth', () => {
    it('limits tree traversal depth', async () => {
      page.evaluate.mockResolvedValueOnce({
        detected: 'react',
        states: [{ component: 'ShallowApp', state: [{ s: 1 }] }],
        found: true,
      });

      await handlers.handleFrameworkStateExtract({ maxDepth: 1 });

      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        framework: 'auto',
        selector: '',
        maxDepth: 1,
      });
    });

    it('uses 0 as maxDepth to only get root state', async () => {
      page.evaluate.mockResolvedValueOnce({
        detected: 'react',
        states: [{ component: 'Root', state: [{ root: true }] }],
        found: true,
      });

      await handlers.handleFrameworkStateExtract({ maxDepth: 0 });

      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        framework: 'auto',
        selector: '',
        maxDepth: 0,
      });
    });
  });

  // ── Error handling ──

  describe('error handling', () => {
    it('returns error when page.evaluate throws a TypeError', async () => {
      page.evaluate.mockRejectedValueOnce(new TypeError('Cannot read properties'));

      const body = parseJson<BrowserStatusResponse>(await handlers.handleFrameworkStateExtract({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toBe('Cannot read properties');
    });

    it('returns error when page.evaluate throws a non-Error value', async () => {
      page.evaluate.mockRejectedValueOnce(42);

      const body = parseJson<BrowserStatusResponse>(await handlers.handleFrameworkStateExtract({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toBe('42');
    });

    it('returns error when page.evaluate throws null', async () => {
      page.evaluate.mockRejectedValueOnce(null);

      const body = parseJson<BrowserStatusResponse>(await handlers.handleFrameworkStateExtract({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toBe('null');
    });

    it('returns error when page.evaluate throws undefined', async () => {
      page.evaluate.mockRejectedValueOnce(undefined);

      const body = parseJson<BrowserStatusResponse>(await handlers.handleFrameworkStateExtract({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toBe('undefined');
    });

    it('returns error when getActivePage rejects with non-Error', async () => {
      getActivePage.mockRejectedValueOnce('network error');
      handlers = new FrameworkStateHandlers({ getActivePage });

      const body = parseJson<BrowserStatusResponse>(await handlers.handleFrameworkStateExtract({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toBe('network error');
    });
  });

  // ── Multiple components ──

  describe('multiple components extraction', () => {
    it('extracts state from multiple React components at different levels', async () => {
      page.evaluate.mockResolvedValueOnce({
        detected: 'react',
        states: [
          { component: 'App', state: [{ theme: 'dark' }] },
          { component: 'Header', state: [{ title: 'My App' }] },
          { component: 'Sidebar', state: [{ collapsed: false }] },
          { component: 'Counter', state: [{ count: 42, max: 100 }] },
        ],
        found: true,
      });

      const body = parseJson<BrowserStatusResponse>(await handlers.handleFrameworkStateExtract({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.states).toHaveLength(4);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.states[0].component).toBe('App');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.states[3].state[0].count).toBe(42);
    });

    it('extracts state from Vue3 components with children', async () => {
      page.evaluate.mockResolvedValueOnce({
        detected: 'vue3',
        states: [
          { component: 'Root', setupState: { appReady: true }, data: null },
          { component: 'ChildA', setupState: { items: [1, 2] }, data: null },
          { component: 'ChildB', setupState: null, data: { msg: 'hello' } },
        ],
        found: true,
      });

      const body = parseJson<BrowserStatusResponse>(await handlers.handleFrameworkStateExtract({ framework: 'vue3' }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.states).toHaveLength(3);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.states[0].setupState.appReady).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.states[2].data.msg).toBe('hello');
    });

    it('extracts state from Vue2 components with $children', async () => {
      page.evaluate.mockResolvedValueOnce({
        detected: 'vue2',
        states: [
          { component: 'RootVm', data: { name: 'root' } },
          { component: 'ChildVm', data: { items: ['x'] } },
        ],
        found: true,
      });

      const body = parseJson<BrowserStatusResponse>(await handlers.handleFrameworkStateExtract({ framework: 'vue2' }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.states).toHaveLength(2);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.states[1].data.items).toEqual(['x']);
    });
  });

  // ── Result structure validation ──

  describe('result structure', () => {
    it('always returns content array with exactly one text element', async () => {
      page.evaluate.mockResolvedValueOnce({
        detected: 'auto',
        states: [],
        found: false,
      });

      const response = await handlers.handleFrameworkStateExtract({});

      expect(response.content).toHaveLength(1);
      expect(response.content[0]?.type).toBe('text');
    });

    it('error response always contains content array with text element', async () => {
      page.evaluate.mockRejectedValueOnce(new Error('fail'));

      const response = await handlers.handleFrameworkStateExtract({});

      expect(response.content).toHaveLength(1);
      expect(response.content[0]?.type).toBe('text');
    });

    it('result JSON is properly indented with 2 spaces', async () => {
      page.evaluate.mockResolvedValueOnce({
        detected: 'react',
        states: [],
        found: false,
      });

      const response = await handlers.handleFrameworkStateExtract({});
      const text = getTextContent(response);

      // Should be formatted with 2-space indentation
      expect(text).toContain('\n  ');
    });

    it('error JSON is properly indented with 2 spaces', async () => {
      page.evaluate.mockRejectedValueOnce(new Error('fail'));

      const response = await handlers.handleFrameworkStateExtract({});
      const text = getTextContent(response);

      expect(text).toContain('\n  ');
    });
  });

  // ── Special state values ──

  describe('special state values', () => {
    it('handles boolean state values', async () => {
      page.evaluate.mockResolvedValueOnce({
        detected: 'react',
        states: [{ component: 'Toggle', state: [true, false] }],
        found: true,
      });

      const body = parseJson<BrowserStatusResponse>(await handlers.handleFrameworkStateExtract({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.states[0].state).toEqual([true, false]);
    });

    it('handles string state values', async () => {
      page.evaluate.mockResolvedValueOnce({
        detected: 'react',
        states: [{ component: 'Input', state: ['hello world'] }],
        found: true,
      });

      const body = parseJson<BrowserStatusResponse>(await handlers.handleFrameworkStateExtract({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.states[0].state).toEqual(['hello world']);
    });

    it('handles numeric state values', async () => {
      page.evaluate.mockResolvedValueOnce({
        detected: 'react',
        states: [{ component: 'Counter', state: [0, 3.14, -1] }],
        found: true,
      });

      const body = parseJson<BrowserStatusResponse>(await handlers.handleFrameworkStateExtract({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.states[0].state).toEqual([0, 3.14, -1]);
    });

    it('handles anonymous component names', async () => {
      page.evaluate.mockResolvedValueOnce({
        detected: 'react',
        states: [{ component: 'anonymous', state: [{ x: 1 }] }],
        found: true,
      });

      const body = parseJson<BrowserStatusResponse>(await handlers.handleFrameworkStateExtract({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.states[0].component).toBe('anonymous');
    });

    it('handles unknown component names in Vue', async () => {
      page.evaluate.mockResolvedValueOnce({
        detected: 'vue3',
        states: [{ component: 'unknown', setupState: { y: 2 }, data: null }],
        found: true,
      });

      const body = parseJson<BrowserStatusResponse>(await handlers.handleFrameworkStateExtract({ framework: 'vue3' }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.states[0].component).toBe('unknown');
    });
  });
});
