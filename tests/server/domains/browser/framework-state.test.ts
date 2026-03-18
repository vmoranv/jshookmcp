import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { FrameworkStateHandlers } from '@server/domains/browser/handlers/framework-state';

type EvaluateFn = (pageFunction: unknown, ...args: unknown[]) => Promise<unknown>;
type GetActivePageFn = () => Promise<unknown>;
type FrameworkStateHandlerResponse = Awaited<
  ReturnType<FrameworkStateHandlers['handleFrameworkStateExtract']>
>;

type FrameworkStateEntry = {
  component: string;
  state?: Array<Record<string, unknown>>;
  setupState?: Record<string, unknown>;
  data?: Record<string, unknown>;
};

type FrameworkStateResult = {
  detected: string;
  states: FrameworkStateEntry[];
  found: boolean;
};

type ErrorResult = {
  success: boolean;
  error: string;
};

function getTextContent(response: FrameworkStateHandlerResponse): string {
  const first = response.content[0];
  expect(first).toBeDefined();
  expect(first?.type).toBe('text');
  if (!first || first.type !== 'text') {
    throw new Error('Expected text tool response');
  }
  return first.text;
}

function parseJson<T>(response: FrameworkStateHandlerResponse): T {
  return JSON.parse(getTextContent(response)) as T;
}

describe('FrameworkStateHandlers', () => {
  let page: { evaluate: Mock<EvaluateFn> };
  let getActivePage: Mock<GetActivePageFn>;
  let handlers: FrameworkStateHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    page = {
      evaluate: vi.fn<EvaluateFn>(),
    };
    getActivePage = vi.fn<GetActivePageFn>(async () => page);
    handlers = new FrameworkStateHandlers({ getActivePage });
  });

  // ─── Default args ───

  it('uses default extract options when args are omitted', async () => {
    page.evaluate.mockResolvedValueOnce({
      detected: 'react',
      states: [{ component: 'App', state: [{ count: 1 }] }],
      found: true,
    });

    const body = parseJson<FrameworkStateResult>(await handlers.handleFrameworkStateExtract({}));

    expect(getActivePage).toHaveBeenCalledOnce();
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
      })
    );

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
    page.evaluate.mockRejectedValueOnce(new Error('framework explode'));

    const body = parseJson<ErrorResult>(
      await handlers.handleFrameworkStateExtract({
        framework: 'react',
      })
    );

    expect(body.success).toBe(false);
    expect(body.error).toBe('framework explode');
  });

  it('returns an error payload when page evaluation fails with string', async () => {
    page.evaluate.mockRejectedValueOnce('string error');

    const body = parseJson<ErrorResult>(await handlers.handleFrameworkStateExtract({}));

    expect(body.success).toBe(false);
    expect(body.error).toBe('string error');
  });

  it('returns an error payload when getActivePage rejects', async () => {
    getActivePage.mockRejectedValueOnce(new Error('no page'));
    handlers = new FrameworkStateHandlers({ getActivePage });

    const body = parseJson<ErrorResult>(await handlers.handleFrameworkStateExtract({}));

    expect(body.success).toBe(false);
    expect(body.error).toBe('no page');
  });

  // ─── React result shapes ───

  it('returns react state with multiple components', async () => {
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
    page.evaluate.mockResolvedValueOnce({
      detected: 'vue2',
      states: [{ component: 'MainApp', data: { items: [1, 2, 3] } }],
      found: true,
    });

    const body = parseJson<FrameworkStateResult>(
      await handlers.handleFrameworkStateExtract({ framework: 'vue2' })
    );

    expect(body.detected).toBe('vue2');
    const data = body.states[0]?.data as { items: number[] } | undefined;
    expect(data?.items).toEqual([1, 2, 3]);
  });

  // ─── Empty / no framework ───

  it('returns empty states when no framework detected', async () => {
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
    page.evaluate.mockResolvedValueOnce({
      detected: 'react',
      states: [],
      found: false,
    });

    await handlers.handleFrameworkStateExtract({ framework: 'react' });

    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      framework: 'react',
      selector: '',
      maxDepth: 5,
    });
  });

  it('uses default framework when only selector is specified', async () => {
    page.evaluate.mockResolvedValueOnce({
      detected: 'auto',
      states: [],
      found: false,
    });

    await handlers.handleFrameworkStateExtract({ selector: '.container' });

    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      framework: 'auto',
      selector: '.container',
      maxDepth: 5,
    });
  });

  it('uses default selector when only maxDepth is specified', async () => {
    page.evaluate.mockResolvedValueOnce({
      detected: 'auto',
      states: [],
      found: false,
    });

    await handlers.handleFrameworkStateExtract({ maxDepth: 3 });

    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      framework: 'auto',
      selector: '',
      maxDepth: 3,
    });
  });

  // ─── Result structure ───

  it('wraps result in content array with type text', async () => {
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
    if (!content || content.type !== 'text') {
      throw new Error('Expected text response');
    }
    expect(() => JSON.parse(content.text)).not.toThrow();
  });

  it('wraps error result in content array with type text', async () => {
    page.evaluate.mockRejectedValueOnce(new Error('fail'));

    const response = await handlers.handleFrameworkStateExtract({});

    expect(response.content).toHaveLength(1);
    const content = response.content[0];
    expect(content).toBeDefined();
    expect(content?.type).toBe('text');
    if (!content || content.type !== 'text') {
      throw new Error('Expected text response');
    }
    const parsed = JSON.parse(content.text) as ErrorResult;
    expect(parsed.success).toBe(false);
  });

  // ─── Complex state objects ───

  it('handles nested state objects from React', async () => {
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
      await handlers.handleFrameworkStateExtract({ framework: 'vue3' })
    );

    const setupState = body.states[0]?.setupState as
      | { loading: boolean; data: number[] }
      | undefined;
    const data = body.states[0]?.data as { legacy: boolean } | undefined;
    expect(setupState?.loading).toBe(false);
    expect(data?.legacy).toBe(true);
  });
});
