import { parseJson } from '@tests/server/domains/shared/mock-factories';
import type { BrowserStatusResponse } from '@tests/shared/common-test-types';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { IndexedDBDumpHandlers } from '@server/domains/browser/handlers/indexeddb-dump';

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
type EvaluateFn = (pageFunction: any, ...args: any[]) => Promise<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
type GetActivePageFn = () => Promise<any>;



describe('IndexedDBDumpHandlers', () => {
  let page: { evaluate: Mock<EvaluateFn> };
  let getActivePage: Mock<GetActivePageFn>;
  let handlers: IndexedDBDumpHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    page = {
      evaluate: vi.fn<EvaluateFn>(),
    };
    getActivePage = vi.fn<GetActivePageFn>(async () => page);
    handlers = new IndexedDBDumpHandlers({ getActivePage });
  });

  it('uses default dump options when args are omitted', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    page.evaluate.mockResolvedValueOnce({
      appDb: {
        users: [{ id: 1, name: 'alice' }],
      },
    });

    const body = parseJson<BrowserStatusResponse>(await handlers.handleIndexedDBDump({}));

    expect(getActivePage).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      database: '',
      store: '',
      maxRecords: 100,
    });
    expect(body).toEqual({
      appDb: {
        users: [{ id: 1, name: 'alice' }],
      },
    });
  });

  it('passes explicit database, store, and maxRecords values through to page.evaluate', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    page.evaluate.mockResolvedValueOnce({
      analyticsDb: {
        events: [{ id: 9, type: 'click' }],
      },
    });

    const body = parseJson<BrowserStatusResponse>(
      await handlers.handleIndexedDBDump({
        database: 'analyticsDb',
        store: 'events',
        maxRecords: 10,
      })
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      database: 'analyticsDb',
      store: 'events',
      maxRecords: 10,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.analyticsDb.events).toEqual([{ id: 9, type: 'click' }]);
  });

  it('returns an error payload when the dump fails', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    page.evaluate.mockRejectedValueOnce(new Error('indexeddb failed'));

    const body = parseJson<BrowserStatusResponse>(
      await handlers.handleIndexedDBDump({
        database: 'appDb',
      })
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toBe('indexeddb failed');
  });
});
