import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FrameworkStateHandlers } from '@server/domains/browser/handlers/framework-state';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('FrameworkStateHandlers', () => {
  let page: { evaluate: ReturnType<typeof vi.fn> };
  let getActivePage: ReturnType<typeof vi.fn>;
  let handlers: FrameworkStateHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    page = {
      evaluate: vi.fn(),
    };
    getActivePage = vi.fn(async () => page);
    handlers = new FrameworkStateHandlers({ getActivePage });
  });

  // ─── Default args ───

  it('uses default extract options when args are omitted', async () => {
    page.evaluate.mockResolvedValueOnce({
      detected: 'react',
      states: [{ component: 'App', state: [{ count: 1 }] }],
      found: true,
    });

    const body = parseJson(await handlers.handleFrameworkStateExtract({}));

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

    const body = parseJson(
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

    const body = parseJson(
      await handlers.handleFrameworkStateExtract({
        framework: 'react',
      })
    );

    expect(body.success).toBe(false);
    expect(body.error).toBe('framework explode');
  });

  it('returns an error payload when page evaluation fails with string', async () => {
    page.evaluate.mockRejectedValueOnce('string error');

    const body = parseJson(await handlers.handleFrameworkStateExtract({}));

    expect(body.success).toBe(false);
    expect(body.error).toBe('string error');
  });

  it('returns an error payload when getActivePage rejects', async () => {
    getActivePage.mockRejectedValueOnce(new Error('no page'));
    handlers = new FrameworkStateHandlers({ getActivePage });

    const body = parseJson(await handlers.handleFrameworkStateExtract({}));

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

    const body = parseJson(await handlers.handleFrameworkStateExtract({}));

    expect(body.detected).toBe('react');
    expect(body.found).toBe(true);
    expect(body.states).toHaveLength(2);
    expect(body.states[0].component).toBe('App');
    expect(body.states[1].state[0].count).toBe(42);
  });

  // ─── Vue2 result shapes ───

  it('returns vue2 state correctly', async () => {
    page.evaluate.mockResolvedValueOnce({
      detected: 'vue2',
      states: [{ component: 'MainApp', data: { items: [1, 2, 3] } }],
      found: true,
    });

    const body = parseJson(
      await handlers.handleFrameworkStateExtract({ framework: 'vue2' })
    );

    expect(body.detected).toBe('vue2');
    expect(body.states[0].data.items).toEqual([1, 2, 3]);
  });

  // ─── Empty / no framework ───

  it('returns empty states when no framework detected', async () => {
    page.evaluate.mockResolvedValueOnce({
      detected: 'auto',
      states: [],
      found: false,
    });

    const body = parseJson(await handlers.handleFrameworkStateExtract({}));

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
    expect(response.content[0].type).toBe('text');
    expect(() => JSON.parse(response.content[0].text)).not.toThrow();
  });

  it('wraps error result in content array with type text', async () => {
    page.evaluate.mockRejectedValueOnce(new Error('fail'));

    const response = await handlers.handleFrameworkStateExtract({});

    expect(response.content).toHaveLength(1);
    expect(response.content[0].type).toBe('text');
    const parsed = JSON.parse(response.content[0].text);
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

    const body = parseJson(await handlers.handleFrameworkStateExtract({}));

    expect(body.found).toBe(true);
    expect(body.states[0].state[0].fields.name).toBe('test');
    expect(body.states[0].state[0].isValid).toBe(true);
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

    const body = parseJson(
      await handlers.handleFrameworkStateExtract({ framework: 'vue3' })
    );

    expect(body.states[0].setupState.loading).toBe(false);
    expect(body.states[0].data.legacy).toBe(true);
  });
});
