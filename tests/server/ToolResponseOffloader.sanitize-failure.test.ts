import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DetailedDataManager } from '@utils/DetailedDataManager';

/**
 * Regression test: a rejection from `sanitizeForCache` while handling a detail
 * wrapper must not reject `offload()` (the sibling offload tasks all preserve
 * the original payload on failure). Previously this task had no try/catch, so
 * `Promise.all` rejected and the whole tool response failed.
 */
const { sanitizeError } = vi.hoisted(() => ({
  sanitizeError: new Error('sanitize boom'),
}));

vi.mock('@utils/sanitizeForCache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@utils/sanitizeForCache')>();
  return {
    ...actual,
    sanitizeForCache: vi.fn(async () => {
      throw sanitizeError;
    }),
  };
});

import { LargeDataOffloader } from '@server/ToolResponseOffloader';
import { logger } from '@utils/logger';

function createDetailManager(): DetailedDataManager {
  return {
    store: vi.fn(() => 'detail_123'),
    cache: new Map([['detail_123', { size: 1024 }]]),
  } as unknown as DetailedDataManager;
}

describe('LargeDataOffloader — sanitizeForCache failure preserves payload', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('resolves with the original text when detail-wrapper sanitization throws', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const offloader = new LargeDataOffloader(createDetailManager());
    const bigText = JSON.stringify({
      detailId: 'detail_abc',
      data: { blob: 'x'.repeat(600 * 1024) },
    });
    const response = { content: [{ type: 'text' as const, text: bigText }] };

    await expect(offloader.offload('get_detailed_data', response)).resolves.toBe(response);

    expect((response.content[0] as { text: string }).text).toBe(bigText);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to sanitize get_detailed_data detail wrapper'),
      sanitizeError,
    );
    warnSpy.mockRestore();
  });
});
