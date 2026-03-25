import { parseJson } from '@tests/server/domains/shared/mock-factories';
import type { BrowserStatusResponse } from '@tests/shared/common-test-types';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { FrameworkStateHandlers } from '@server/domains/browser/handlers/framework-state';

function createMockPage() {
  return {
    evaluate: vi.fn(),
    createCDPSession: vi.fn(async () => ({ send: vi.fn(async () => ({ result: { value: 1 } })) })),
  };
}

function createHandlers(page: ReturnType<typeof createMockPage>) {
  return new FrameworkStateHandlers({
    getActivePage: vi.fn(async () => page),
  });
}

describe('FrameworkStateHandlers – additional coverage', () => {
  let page: ReturnType<typeof createMockPage>;
  let handlers: FrameworkStateHandlers;

  beforeEach(() => {
    page = createMockPage();
    handlers = createHandlers(page);
  });

  describe('handleFrameworkStateExtract – React detection', () => {
    it('extracts React component state', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValue({
        detected: 'react',
        states: [
          { component: 'App', state: [{ count: 0 }] },
          { component: 'Counter', state: [{ value: 42 }] },
        ],
        found: true,
      });

      const result = await handlers.handleFrameworkStateExtract({
        framework: 'react',
      });

      expect(result.content).toHaveLength(1);
      const parsed = parseJson<BrowserStatusResponse>(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.detected).toBe('react');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.found).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.states).toHaveLength(2);
    });

    it('returns empty states when no React fiber found', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValue({
        detected: 'react',
        states: [],
        found: false,
      });

      const result = await handlers.handleFrameworkStateExtract({
        framework: 'react',
      });

      const parsed = parseJson<BrowserStatusResponse>(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.found).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.states).toHaveLength(0);
    });
  });

  describe('handleFrameworkStateExtract – Vue 3 detection', () => {
    it('extracts Vue 3 component state', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValue({
        detected: 'vue3',
        states: [{ component: 'App', setupState: { msg: 'Hello' }, data: null }],
        found: true,
      });

      const result = await handlers.handleFrameworkStateExtract({
        framework: 'vue3',
      });

      const parsed = parseJson<BrowserStatusResponse>(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.detected).toBe('vue3');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.found).toBe(true);
    });
  });

  describe('handleFrameworkStateExtract – Vue 2 detection', () => {
    it('extracts Vue 2 component state', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValue({
        detected: 'vue2',
        states: [{ component: 'MyComponent', data: { message: 'world' } }],
        found: true,
      });

      const result = await handlers.handleFrameworkStateExtract({
        framework: 'vue2',
      });

      const parsed = parseJson<BrowserStatusResponse>(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.detected).toBe('vue2');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.found).toBe(true);
    });
  });

  describe('handleFrameworkStateExtract – auto detection', () => {
    it('auto-detects React framework', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValue({
        detected: 'react',
        states: [{ component: 'Root', state: [true] }],
        found: true,
      });

      const result = await handlers.handleFrameworkStateExtract({});

      const parsed = parseJson<BrowserStatusResponse>(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.detected).toBe('react');
    });

    it('auto-detects Vue 3 framework', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValue({
        detected: 'vue3',
        states: [{ component: 'App', setupState: {} }],
        found: true,
      });

      const result = await handlers.handleFrameworkStateExtract({
        framework: 'auto',
      });

      const parsed = parseJson<BrowserStatusResponse>(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.detected).toBe('vue3');
    });

    it('auto-detects Vue 2 framework', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValue({
        detected: 'vue2',
        states: [{ component: 'OldApp', data: {} }],
        found: true,
      });

      const result = await handlers.handleFrameworkStateExtract({
        framework: 'auto',
      });

      const parsed = parseJson<BrowserStatusResponse>(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.detected).toBe('vue2');
    });

    it('returns no framework when none detected', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValue({
        detected: 'auto',
        states: [],
        found: false,
      });

      const result = await handlers.handleFrameworkStateExtract({});

      const parsed = parseJson<BrowserStatusResponse>(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.found).toBe(false);
    });
  });

  describe('handleFrameworkStateExtract – with selector', () => {
    it('uses custom selector', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValue({
        detected: 'react',
        states: [{ component: 'Widget', state: [{ open: true }] }],
        found: true,
      });

      const result = await handlers.handleFrameworkStateExtract({
        selector: '#my-widget',
        framework: 'react',
      });

      const parsed = parseJson<BrowserStatusResponse>(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.found).toBe(true);
      // Verify the evaluate was called (args passed to page.evaluate)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        framework: 'react',
        selector: '#my-widget',
        maxDepth: 5,
      });
    });
  });

  describe('handleFrameworkStateExtract – with maxDepth', () => {
    it('respects custom maxDepth', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValue({
        detected: 'react',
        states: [],
        found: false,
      });

      await handlers.handleFrameworkStateExtract({
        maxDepth: 10,
        framework: 'react',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        framework: 'react',
        selector: '',
        maxDepth: 10,
      });
    });
  });

  describe('handleFrameworkStateExtract – defaults', () => {
    it('uses default values when no args provided', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValue({
        detected: 'auto',
        states: [],
        found: false,
      });

      await handlers.handleFrameworkStateExtract({});

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        framework: 'auto',
        selector: '',
        maxDepth: 5,
      });
    });
  });

  describe('handleFrameworkStateExtract – error handling', () => {
    it('returns error response when page.evaluate throws', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockRejectedValue(new Error('Page navigation interrupted'));

      const result = await handlers.handleFrameworkStateExtract({
        framework: 'react',
      });

      expect(result.content).toHaveLength(1);
      const parsed = parseJson<BrowserStatusResponse>(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.error).toBe('Page navigation interrupted');
    });

    it('handles non-Error thrown values', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockRejectedValue('string error');

      const result = await handlers.handleFrameworkStateExtract({});

      const parsed = parseJson<BrowserStatusResponse>(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.error).toBe('string error');
    });
  });

  describe('handleFrameworkStateExtract – complex states', () => {
    it('handles nested component state tree', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValue({
        detected: 'react',
        states: [
          { component: 'App', state: [{ theme: 'dark', user: { name: 'Test' } }] },
          { component: 'Sidebar', state: [{ collapsed: false }] },
          { component: 'Header', state: [{ title: 'Dashboard' }] },
        ],
        found: true,
      });

      const result = await handlers.handleFrameworkStateExtract({
        framework: 'react',
        maxDepth: 3,
      });

      const parsed = parseJson<BrowserStatusResponse>(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.states).toHaveLength(3);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.states?.[0]).toMatchObject({
        component: 'App',
        state: [{ theme: 'dark' }],
      });
    });

    it('handles Vue component with both setupState and data', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValue({
        detected: 'vue3',
        states: [
          {
            component: 'Dashboard',
            setupState: { items: [1, 2, 3], loading: false },
            data: { legacyProp: 'old' },
          },
        ],
        found: true,
      });

      const result = await handlers.handleFrameworkStateExtract({
        framework: 'vue3',
      });

      const parsed = parseJson<BrowserStatusResponse>(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.states?.[0]).toMatchObject({
        setupState: { items: [1, 2, 3] },
      });
    });
  });
});
