import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { IndexedDBDumpHandlers } from '@server/domains/browser/handlers/indexeddb-dump';

type EvaluateFn = (pageFunction: unknown, ...args: unknown[]) => Promise<unknown>;
type GetActivePageFn = () => Promise<unknown>;

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

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
    page.evaluate.mockResolvedValueOnce({
      appDb: {
        users: [{ id: 1, name: 'alice' }],
      },
    });

    const body = parseJson(await handlers.handleIndexedDBDump({}));

    expect(getActivePage).toHaveBeenCalledOnce();
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
    page.evaluate.mockResolvedValueOnce({
      analyticsDb: {
        events: [{ id: 9, type: 'click' }],
      },
    });

    const body = parseJson(
      await handlers.handleIndexedDBDump({
        database: 'analyticsDb',
        store: 'events',
        maxRecords: 10,
      })
    );

    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      database: 'analyticsDb',
      store: 'events',
      maxRecords: 10,
    });
    expect(body.analyticsDb.events).toEqual([{ id: 9, type: 'click' }]);
  });

  it('returns an error payload when the dump fails', async () => {
    page.evaluate.mockRejectedValueOnce(new Error('indexeddb failed'));

    const body = parseJson(
      await handlers.handleIndexedDBDump({
        database: 'appDb',
      })
    );

    expect(body.success).toBe(false);
    expect(body.error).toBe('indexeddb failed');
  });
});
