import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DetailedDataHandlers } from '@server/domains/browser/handlers/detailed-data';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('DetailedDataHandlers', () => {
  const detailedDataManager = {
    retrieve: vi.fn(),
  } as any;

  let handlers: DetailedDataHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new DetailedDataHandlers({ detailedDataManager });
  });

  it('returns detailed data and defaults path to full', async () => {
    detailedDataManager.retrieve.mockReturnValue({
      nested: { value: 42 },
    });

    const body = parseJson(await handlers.handleGetDetailedData({ detailId: 'detail-1' }));

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
    detailedDataManager.retrieve.mockReturnValue(['line 1', 'line 2']);

    const body = parseJson(
      await handlers.handleGetDetailedData({
        detailId: 'detail-2',
        path: 'scripts[0].source',
      })
    );

    expect(detailedDataManager.retrieve).toHaveBeenCalledWith('detail-2', 'scripts[0].source');
    expect(body.path).toBe('scripts[0].source');
    expect(body.data).toEqual(['line 1', 'line 2']);
  });

  it('returns an error payload when retrieval fails', async () => {
    detailedDataManager.retrieve.mockImplementation(() => {
      throw new Error('detail expired');
    });

    const body = parseJson(await handlers.handleGetDetailedData({ detailId: 'expired-detail' }));

    expect(body.success).toBe(false);
    expect(body.error).toBe('detail expired');
    expect(body.hint).toContain('TTL: 10 minutes');
  });
});
