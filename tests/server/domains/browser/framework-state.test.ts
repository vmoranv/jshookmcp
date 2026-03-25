import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { FrameworkStateHandlers } from '@server/domains/browser/handlers/framework-state';

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
type EvaluateFn = (pageFunction: any, ...args: any[]) => Promise<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
type GetActivePageFn = () => Promise<any>;

type FrameworkStateEntry = {
  component: string;
  state?: Array<Record<string, unknown>>;
  setupState?: Record<string, unknown>;
  data?: Record<string, unknown>;
  file?: string;
  props?: Record<string, unknown>;
};

type MetaFrameworkInfo = {
  framework: string;
  route?: string;
  buildId?: string;
  state?: Record<string, unknown>;
  config?: Record<string, unknown>;
  payload?: unknown;
  props?: unknown;
  runtimeConfig?: unknown;
  serverRendered?: boolean;
};

type FrameworkStateResult = {
  detected: string;
  states: FrameworkStateEntry[];
  found: boolean;
  meta?: MetaFrameworkInfo;
};

type ErrorResult = {
  success: boolean;
  error: string;
};

describe('FrameworkStateHandlers', () => {
  let page: { evaluate: Mock<EvaluateFn> };
  let getActivePage: Mock<GetActivePageFn>;
  let handlers: FrameworkStateHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    page = {
      evaluate: vi.fn<EvaluateFn>(),
      createCDPSession: vi.fn(async () => ({
        send: vi.fn(async () => ({ result: { value: 1 } })),
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any;
    getActivePage = vi.fn<GetActivePageFn>(async () => page);
    handlers = new FrameworkStateHandlers({ getActivePage });
  });

  // ─── Default args ───

  it('uses default extract options when args are omitted', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    page.evaluate.mockResolvedValueOnce({
      detected: 'react',
      states: [{ component: 'App', state: [{ count: 1 }] }],
      found: true,
    });

    const body = parseJson<FrameworkStateResult>(await handlers.handleFrameworkStateExtract({}));

    expect(getActivePage).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      framework: 'auto',
      selector: '',
      maxDepth: 5,
    });
    expect(body).toEqual({
      detected: 'react',
      states: [{ component: 'App', state: [{ count: 1 }] }],
      found: true,
    });
  });

  // ─── Explicit args ───

  it('passes explicit extract options through to page.evaluate', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    page.evaluate.mockResolvedValueOnce({
      detected: 'vue3',
      states: [{ component: 'Root', setupState: { ready: true }, data: { count: 2 } }],
      found: true,
    });

    const body = parseJson<FrameworkStateResult>(
      await handlers.handleFrameworkStateExtract({
        framework: 'vue3',
        selector: '#app',
        maxDepth: 2,
      }),
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      framework: 'vue3',
      selector: '#app',
      maxDepth: 2,
    });
    expect(body.detected).toBe('vue3');
    expect(body.found).toBe(true);
  });

  // ─── Error handling ───

  it('returns an error payload when page evaluation fails with Error', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    page.evaluate.mockRejectedValueOnce(new Error('framework explode'));

    const body = parseJson<ErrorResult>(
      await handlers.handleFrameworkStateExtract({
        framework: 'react',
      }),
    );

    expect(body.success).toBe(false);
    expect(body.error).toBe('framework explode');
  });

  it('returns an error payload when page evaluation fails with string', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    page.evaluate.mockRejectedValueOnce('string error');

    const body = parseJson<ErrorResult>(await handlers.handleFrameworkStateExtract({}));

    expect(body.success).toBe(false);
    expect(body.error).toBe('string error');
  });

  it('returns an error payload when getActivePage rejects', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    getActivePage.mockRejectedValueOnce(new Error('no page'));
    handlers = new FrameworkStateHandlers({ getActivePage });

    const body = parseJson<ErrorResult>(await handlers.handleFrameworkStateExtract({}));

    expect(body.success).toBe(false);
    expect(body.error).toBe('no page');
  });

  // ─── React result shapes ───

  it('returns react state with multiple components', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    page.evaluate.mockResolvedValueOnce({
      detected: 'react',
      states: [
        { component: 'App', state: [{ theme: 'dark' }] },
        { component: 'Counter', state: [{ count: 42 }] },
      ],
      found: true,
    });

    const body = parseJson<FrameworkStateResult>(await handlers.handleFrameworkStateExtract({}));

    expect(body.detected).toBe('react');
    expect(body.found).toBe(true);
    expect(body.states).toHaveLength(2);
    expect(body.states[0]?.component).toBe('App');
    const counterState = body.states[1]?.state?.[0] as { count: number } | undefined;
    expect(counterState?.count).toBe(42);
  });

  // ─── Vue2 result shapes ───

  it('returns vue2 state correctly', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    page.evaluate.mockResolvedValueOnce({
      detected: 'vue2',
      states: [{ component: 'MainApp', data: { items: [1, 2, 3] } }],
      found: true,
    });

    const body = parseJson<FrameworkStateResult>(
      await handlers.handleFrameworkStateExtract({ framework: 'vue2' }),
    );

    expect(body.detected).toBe('vue2');
    const data = body.states[0]?.data as { items: number[] } | undefined;
    expect(data?.items).toEqual([1, 2, 3]);
  });

  // ─── Empty / no framework ───

  it('returns empty states when no framework detected', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    page.evaluate.mockResolvedValueOnce({
      detected: 'auto',
      states: [],
      found: false,
    });

    const body = parseJson<FrameworkStateResult>(await handlers.handleFrameworkStateExtract({}));

    expect(body.detected).toBe('auto');
    expect(body.found).toBe(false);
    expect(body.states).toEqual([]);
  });

  // ─── Partial args ───

  it('uses default maxDepth when only framework is specified', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    page.evaluate.mockResolvedValueOnce({
      detected: 'react',
      states: [],
      found: false,
    });

    await handlers.handleFrameworkStateExtract({ framework: 'react' });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      framework: 'react',
      selector: '',
      maxDepth: 5,
    });
  });

  it('uses default framework when only selector is specified', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    page.evaluate.mockResolvedValueOnce({
      detected: 'auto',
      states: [],
      found: false,
    });

    await handlers.handleFrameworkStateExtract({ selector: '.container' });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      framework: 'auto',
      selector: '.container',
      maxDepth: 5,
    });
  });

  it('uses default selector when only maxDepth is specified', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    page.evaluate.mockResolvedValueOnce({
      detected: 'auto',
      states: [],
      found: false,
    });

    await handlers.handleFrameworkStateExtract({ maxDepth: 3 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      framework: 'auto',
      selector: '',
      maxDepth: 3,
    });
  });

  // ─── Result structure ───

  it('wraps result in content array with type text', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    page.evaluate.mockResolvedValueOnce({
      detected: 'react',
      states: [],
      found: false,
    });

    const response = await handlers.handleFrameworkStateExtract({});

    expect(response.content).toHaveLength(1);
    const content = response.content[0];
    expect(content).toBeDefined();
    expect(content?.type).toBe('text');
    if (content?.type !== 'text') {
      throw new Error('Expected text response');
    }
    expect(() => JSON.parse(content.text)).not.toThrow();
  });

  it('wraps error result in content array with type text', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    page.evaluate.mockRejectedValueOnce(new Error('fail'));

    const response = await handlers.handleFrameworkStateExtract({});

    expect(response.content).toHaveLength(1);
    const content = response.content[0];
    expect(content).toBeDefined();
    expect(content?.type).toBe('text');
    if (content?.type !== 'text') {
      throw new Error('Expected text response');
    }
    const parsed = JSON.parse(content.text) as ErrorResult;
    expect(parsed.success).toBe(false);
  });

  // ─── Complex state objects ───

  it('handles nested state objects from React', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    page.evaluate.mockResolvedValueOnce({
      detected: 'react',
      states: [
        {
          component: 'Form',
          state: [
            {
              fields: { name: 'test', email: 'a@b.com' },
              errors: {},
              isValid: true,
            },
          ],
        },
      ],
      found: true,
    });

    const body = parseJson<FrameworkStateResult>(await handlers.handleFrameworkStateExtract({}));

    expect(body.found).toBe(true);
    const formState = body.states[0]?.state?.[0] as
      | {
          fields: { name: string; email: string };
          errors: Record<string, unknown>;
          isValid: boolean;
        }
      | undefined;
    expect(formState?.fields.name).toBe('test');
    expect(formState?.isValid).toBe(true);
  });

  it('handles Vue3 setupState + data combo', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    page.evaluate.mockResolvedValueOnce({
      detected: 'vue3',
      states: [
        {
          component: 'Dashboard',
          setupState: { loading: false, data: [1, 2] },
          data: { legacy: true },
        },
      ],
      found: true,
    });

    const body = parseJson<FrameworkStateResult>(
      await handlers.handleFrameworkStateExtract({ framework: 'vue3' }),
    );

    const setupState = body.states[0]?.setupState as
      | { loading: boolean; data: number[] }
      | undefined;
    expect(setupState?.loading).toBe(false);
    expect((body.states[0]?.data as { legacy: boolean } | undefined)?.legacy).toBe(true);
  });

  // ─── Svelte result shapes ───

  it('returns svelte state correctly', async () => {
    page.evaluate.mockResolvedValueOnce({
      detected: 'svelte',
      states: [
        {
          component: 'src/routes/+page.svelte',
          state: [{ $0: 'hello', $1: 42 }],
          file: 'src/routes/+page.svelte',
        },
      ],
      found: true,
    });

    const body = parseJson<FrameworkStateResult>(
      await handlers.handleFrameworkStateExtract({ framework: 'svelte' }),
    );

    expect(body.detected).toBe('svelte');
    expect(body.found).toBe(true);
    expect(body.states).toHaveLength(1);
    expect(body.states[0]?.component).toContain('svelte');
  });

  // ─── Solid result shapes ───

  it('returns solid state correctly', async () => {
    page.evaluate.mockResolvedValueOnce({
      detected: 'solid',
      states: [{ component: 'Counter', state: [{ count: 10 }] }],
      found: true,
    });

    const body = parseJson<FrameworkStateResult>(
      await handlers.handleFrameworkStateExtract({ framework: 'solid' }),
    );

    expect(body.detected).toBe('solid');
    expect(body.found).toBe(true);
    expect(body.states[0]?.component).toBe('Counter');
  });

  it('returns solid with hydration-only detection', async () => {
    page.evaluate.mockResolvedValueOnce({
      detected: 'solid',
      states: [
        {
          component: 'SolidRoot',
          state: [
            {
              _note:
                'Solid detected via hydration markers; install solid-devtools for full state extraction',
            },
          ],
        },
      ],
      found: true,
    });

    const body = parseJson<FrameworkStateResult>(await handlers.handleFrameworkStateExtract({}));

    expect(body.detected).toBe('solid');
    expect(body.found).toBe(true);
  });

  // ─── Preact result shapes ───

  it('returns preact state correctly', async () => {
    page.evaluate.mockResolvedValueOnce({
      detected: 'preact',
      states: [
        {
          component: 'TodoList',
          state: [{ items: ['a', 'b'] }],
          props: { title: 'My Todos' },
        },
      ],
      found: true,
    });

    const body = parseJson<FrameworkStateResult>(
      await handlers.handleFrameworkStateExtract({ framework: 'preact' }),
    );

    expect(body.detected).toBe('preact');
    expect(body.found).toBe(true);
    expect(body.states[0]?.component).toBe('TodoList');
  });

  // ─── Meta-framework metadata ───

  it('returns nextjs meta-framework metadata', async () => {
    page.evaluate.mockResolvedValueOnce({
      detected: 'react',
      states: [{ component: 'App', state: [{ user: 'test' }] }],
      found: true,
      meta: {
        framework: 'nextjs',
        route: '/dashboard',
        buildId: 'abc123',
        props: { pageProps: {} },
      },
    });

    const body = parseJson<FrameworkStateResult>(await handlers.handleFrameworkStateExtract({}));

    expect(body.detected).toBe('react');
    expect(body.found).toBe(true);
    expect(body.meta).toBeDefined();
    expect(body.meta?.framework).toBe('nextjs');
    expect(body.meta?.route).toBe('/dashboard');
    expect(body.meta?.buildId).toBe('abc123');
  });

  it('returns nuxt3 meta-framework metadata', async () => {
    page.evaluate.mockResolvedValueOnce({
      detected: 'vue3',
      states: [{ component: 'NuxtApp', setupState: { count: 0 } }],
      found: true,
      meta: {
        framework: 'nuxt3',
        state: {},
        config: { public: { apiBase: '/api' } },
      },
    });

    const body = parseJson<FrameworkStateResult>(
      await handlers.handleFrameworkStateExtract({ framework: 'vue3' }),
    );

    expect(body.meta?.framework).toBe('nuxt3');
    expect(body.meta?.config).toBeDefined();
  });

  it('returns no meta when meta-framework not detected', async () => {
    page.evaluate.mockResolvedValueOnce({
      detected: 'react',
      states: [{ component: 'App', state: [{ count: 0 }] }],
      found: true,
    });

    const body = parseJson<FrameworkStateResult>(await handlers.handleFrameworkStateExtract({}));

    expect(body.meta).toBeUndefined();
  });

  // ─── Framework enum coverage ───

  it('passes svelte framework option to page.evaluate', async () => {
    page.evaluate.mockResolvedValueOnce({
      detected: 'svelte',
      states: [],
      found: false,
    });

    await handlers.handleFrameworkStateExtract({ framework: 'svelte' });

    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      framework: 'svelte',
      selector: '',
      maxDepth: 5,
    });
  });

  it('passes solid framework option to page.evaluate', async () => {
    page.evaluate.mockResolvedValueOnce({
      detected: 'solid',
      states: [],
      found: false,
    });

    await handlers.handleFrameworkStateExtract({ framework: 'solid' });

    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      framework: 'solid',
      selector: '',
      maxDepth: 5,
    });
  });

  it('passes preact framework option to page.evaluate', async () => {
    page.evaluate.mockResolvedValueOnce({
      detected: 'preact',
      states: [],
      found: false,
    });

    await handlers.handleFrameworkStateExtract({ framework: 'preact' });

    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      framework: 'preact',
      selector: '',
      maxDepth: 5,
    });
  });
});
