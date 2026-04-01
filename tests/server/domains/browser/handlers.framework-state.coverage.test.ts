import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FrameworkStateHandlers } from '@server/domains/browser/handlers/framework-state';

// ── helpers ──────────────────────────────────────────────────────────────────

const fakePage = (overrides: Record<string, unknown> = {}): unknown => ({
  evaluate: vi.fn().mockResolvedValue({ detected: 'react', states: [], found: false }),
  createCDPSession: vi.fn().mockResolvedValue({
    send: vi.fn().mockResolvedValue({ result: { value: 1 } }),
  }),
  ...overrides,
});

// ── test subject ──────────────────────────────────────────────────────────────

const makeHandlers = (getActivePage: () => Promise<unknown>) =>
  new FrameworkStateHandlers({ getActivePage });

// ── happy paths ───────────────────────────────────────────────────────────────

describe('FrameworkStateHandlers', () => {
  let getActivePage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getActivePage = vi.fn();
  });

  // ── handleFrameworkStateExtract — CDP pre-flight ──────────────────────────

  describe('handleFrameworkStateExtract — CDP pre-flight', () => {
    it('passes CDP health check and evaluates page', async () => {
      const cdpSend = vi.fn().mockResolvedValue({ result: { value: 1 } });
      getActivePage.mockResolvedValue(
        fakePage({
          createCDPSession: vi.fn().mockResolvedValue({ send: cdpSend }),
          evaluate: vi.fn().mockResolvedValue({ detected: 'react', states: [], found: false }),
        }),
      );

      const handlers = makeHandlers(getActivePage);
      const result = await handlers.handleFrameworkStateExtract({});

      expect(cdpSend).toHaveBeenCalledWith('Runtime.evaluate', {
        expression: '1',
        returnByValue: true,
      });
      expect(result.content[0]).toBeDefined();
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.detected).toBe('react');
    });

    it('fails fast when CDP session send rejects (debugger blocking)', async () => {
      const cdpSend = vi.fn().mockRejectedValue(new Error('CDP unavailable'));
      getActivePage.mockResolvedValue(
        fakePage({
          createCDPSession: vi.fn().mockResolvedValue({ send: cdpSend }),
        }),
      );

      const handlers = makeHandlers(getActivePage);
      const result = await handlers.handleFrameworkStateExtract({});

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('CDP session unresponsive');
    });

    it('fails fast when CDP session send times out after 3s', async () => {
      const cdpSend = vi
        .fn()
        .mockImplementation(
          () => new Promise((r) => setTimeout(() => r({ result: { value: 1 } }), 5000)),
        );
      getActivePage.mockResolvedValue(
        fakePage({
          createCDPSession: vi.fn().mockResolvedValue({ send: cdpSend }),
        }),
      );

      const handlers = makeHandlers(getActivePage);
      const result = await handlers.handleFrameworkStateExtract({});

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('CDP session unresponsive');
    });

    it('fails fast when createCDPSession throws', async () => {
      getActivePage.mockResolvedValue(
        fakePage({
          createCDPSession: vi.fn().mockRejectedValue(new Error('no CDP')),
        }),
      );

      const handlers = makeHandlers(getActivePage);
      const result = await handlers.handleFrameworkStateExtract({});

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('CDP session unresponsive');
    });

    it('throws PrerequisiteError when CDP session is unreachable', async () => {
      getActivePage.mockResolvedValue(
        fakePage({
          createCDPSession: vi.fn().mockResolvedValue({
            send: vi.fn().mockRejectedValue(new Error('cdp_unreachable')),
          }),
        }),
      );

      const handlers = makeHandlers(getActivePage);
      const result = await handlers.handleFrameworkStateExtract({});

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('debugger_disable');
    });
  });

  // ── handleFrameworkStateExtract — page.evaluate timeout ───────────────────

  describe('handleFrameworkStateExtract — page.evaluate timeout', () => {
    it('returns error when page.evaluate times out after 30000ms', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      const evaluate = vi
        .fn()
        .mockImplementation(
          () => new Promise((r) => setTimeout(() => r({ detected: 'react', states: [] }), 60000)),
        );
      getActivePage.mockResolvedValue(
        fakePage({
          evaluate,
        }),
      );

      const handlers = makeHandlers(getActivePage);
      const resultPromise = handlers.handleFrameworkStateExtract({});

      // Advance past 30s
      await vi.advanceTimersByTimeAsync(35000);

      const result = await resultPromise;
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('timed out');

      vi.useRealTimers();
    });
  });

  // ── handleFrameworkStateExtract — evaluate throws ─────────────────────────

  describe('handleFrameworkStateExtract — evaluate throws', () => {
    it('returns error when page.evaluate rejects with Error', async () => {
      getActivePage.mockResolvedValue(
        fakePage({
          evaluate: vi.fn().mockRejectedValue(new Error('evaluate failed')),
        }),
      );

      const handlers = makeHandlers(getActivePage);
      const result = await handlers.handleFrameworkStateExtract({});

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toBe('evaluate failed');
    });

    it('returns error when page.evaluate rejects with non-Error value', async () => {
      getActivePage.mockResolvedValue(
        fakePage({
          evaluate: vi.fn().mockRejectedValue('string error'),
        }),
      );

      const handlers = makeHandlers(getActivePage);
      const result = await handlers.handleFrameworkStateExtract({});

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toBe('string error');
    });

    it('returns error when getActivePage rejects', async () => {
      getActivePage.mockRejectedValue(new Error('no page'));

      const handlers = makeHandlers(getActivePage);
      const result = await handlers.handleFrameworkStateExtract({});

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toBe('no page');
    });
  });

  // ── handleFrameworkStateExtract — args parsing ─────────────────────────────

  describe('handleFrameworkStateExtract — args', () => {
    it('passes framework=auto (default) to evaluate', async () => {
      const evaluate = vi.fn().mockResolvedValue({ detected: 'react', states: [], found: false });
      getActivePage.mockResolvedValue(fakePage({ evaluate }));

      const handlers = makeHandlers(getActivePage);
      await handlers.handleFrameworkStateExtract({});

      expect(evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ framework: 'auto' }),
      );
    });

    it('passes explicit framework value to evaluate', async () => {
      const evaluate = vi.fn().mockResolvedValue({ detected: 'vue3', states: [], found: false });
      getActivePage.mockResolvedValue(fakePage({ evaluate }));

      const handlers = makeHandlers(getActivePage);
      await handlers.handleFrameworkStateExtract({ framework: 'vue3' });

      expect(evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ framework: 'vue3' }),
      );
    });

    it('passes selector argument to evaluate', async () => {
      const evaluate = vi.fn().mockResolvedValue({ detected: 'react', states: [], found: false });
      getActivePage.mockResolvedValue(fakePage({ evaluate }));

      const handlers = makeHandlers(getActivePage);
      await handlers.handleFrameworkStateExtract({ selector: '#app' });

      expect(evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ selector: '#app' }),
      );
    });

    it('passes maxDepth argument to evaluate', async () => {
      const evaluate = vi.fn().mockResolvedValue({ detected: 'react', states: [], found: false });
      getActivePage.mockResolvedValue(fakePage({ evaluate }));

      const handlers = makeHandlers(getActivePage);
      await handlers.handleFrameworkStateExtract({ maxDepth: 10 });

      expect(evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ maxDepth: 10 }),
      );
    });
  });

  // ── handleFrameworkStateExtract — result shape ─────────────────────────────

  describe('handleFrameworkStateExtract — result shape', () => {
    it('returns content with JSON-serialized result', async () => {
      const evaluate = vi.fn().mockResolvedValue({
        detected: 'react',
        states: [{ component: 'App', state: [{ count: 1 }] }],
        found: true,
        meta: { framework: 'nextjs', route: '/home' },
      });
      getActivePage.mockResolvedValue(fakePage({ evaluate }));

      const handlers = makeHandlers(getActivePage);
      const result = await handlers.handleFrameworkStateExtract({});

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.detected).toBe('react');
      expect(parsed.states[0].component).toBe('App');
      expect(parsed.meta.framework).toBe('nextjs');
    });

    it('returns found=false when no framework detected', async () => {
      const evaluate = vi.fn().mockResolvedValue({
        detected: 'auto',
        states: [],
        found: false,
      });
      getActivePage.mockResolvedValue(fakePage({ evaluate }));

      const handlers = makeHandlers(getActivePage);
      const result = await handlers.handleFrameworkStateExtract({});

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.found).toBe(false);
    });
  });
});
