import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { JsdomHandlers } from '@server/domains/browser/handlers/jsdom-tools';

describe('JsdomHandlers session expiry', () => {
  let handlers: JsdomHandlers | null = null;

  afterEach(() => {
    handlers?.closeAll();
    handlers = null;
    vi.useRealTimers();
  });

  it('refreshes session TTL on access instead of expiring after a fixed lifetime', async () => {
    vi.useFakeTimers();
    handlers = new JsdomHandlers();

    const parsed = parseJson<{ sessionId: string; ttlMs: number }>(
      await handlers.handleJsdomParse({
        html: '<html><body><div id="target">ok</div></body></html>',
      }),
    );

    await vi.advanceTimersByTimeAsync(parsed.ttlMs - 1_000);
    const firstQuery = parseJson<{ success: boolean; matched: number }>(
      await handlers.handleJsdomQuery({ sessionId: parsed.sessionId, selector: '#target' }),
    );
    expect(firstQuery.success).toBe(true);
    expect(firstQuery.matched).toBe(1);

    await vi.advanceTimersByTimeAsync(parsed.ttlMs - 1_000);
    const secondQuery = parseJson<{ success: boolean; matched: number }>(
      await handlers.handleJsdomQuery({ sessionId: parsed.sessionId, selector: '#target' }),
    );
    expect(secondQuery.success).toBe(true);
    expect(secondQuery.matched).toBe(1);

    await vi.advanceTimersByTimeAsync(parsed.ttlMs + 1_000);
    const expired = parseJson<{ success: boolean; error?: string; message?: string }>(
      await handlers.handleJsdomQuery({ sessionId: parsed.sessionId, selector: '#target' }),
    );
    expect(expired.success).toBe(false);
    expect(`${expired.error ?? ''} ${expired.message ?? ''}`).toContain('expired');
  });
});
