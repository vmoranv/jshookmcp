import { parseJson, BrowserStatusResponse } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DetailedDataHandlers } from '@server/domains/browser/handlers/detailed-data';



describe('DetailedDataHandlers', () => {
  const detailedDataManager = {
    retrieve: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  } as any;

  let handlers: DetailedDataHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new DetailedDataHandlers({ detailedDataManager });
  });

  it('returns detailed data and defaults path to full', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    detailedDataManager.retrieve.mockReturnValue({
      nested: { value: 42 },
    });

    const body = parseJson<BrowserStatusResponse>(await handlers.handleGetDetailedData({ detailId: 'detail-1' }));

    expect(detailedDataManager.retrieve).toHaveBeenCalledWith('detail-1', undefined);
    expect(body).toEqual({
      success: true,
      detailId: 'detail-1',
      path: 'full',
      data: {
        nested: { value: 42 },
      },
    });
  });

  it('passes through the requested path', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    detailedDataManager.retrieve.mockReturnValue(['line 1', 'line 2']);

    const body = parseJson<BrowserStatusResponse>(
      await handlers.handleGetDetailedData({
        detailId: 'detail-2',
        path: 'scripts[0].source',
      })
    );

    expect(detailedDataManager.retrieve).toHaveBeenCalledWith('detail-2', 'scripts[0].source');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.path).toBe('scripts[0].source');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.data).toEqual(['line 1', 'line 2']);
  });

  it('returns an error payload when retrieval fails', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    detailedDataManager.retrieve.mockImplementation(() => {
      throw new Error('detail expired');
    });

    const body = parseJson<BrowserStatusResponse>(await handlers.handleGetDetailedData({ detailId: 'expired-detail' }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toBe('detail expired');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.hint).toContain('TTL: 10 minutes');
  });
});
