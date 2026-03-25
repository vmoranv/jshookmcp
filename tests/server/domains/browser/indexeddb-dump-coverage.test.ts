import type { BrowserStatusResponse } from '@tests/server/domains/shared/common-test-types';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { IndexedDBDumpHandlers } from '@server/domains/browser/handlers/indexeddb-dump';

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
type EvaluateFn = (pageFunction: any, ...args: any[]) => Promise<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
type GetActivePageFn = () => Promise<any>;
type IndexedDBDumpResponse = Awaited<ReturnType<IndexedDBDumpHandlers['handleIndexedDBDump']>>;

function getTextContent(response: IndexedDBDumpResponse): string {
  const first = response.content[0];
  expect(first).toBeDefined();
  expect(first?.type).toBe('text');
  if (first?.type !== 'text') {
    throw new Error('Expected text tool response');
  }
  return first.text;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
function parseJson<T>(response: IndexedDBDumpResponse): T {
  return JSON.parse(getTextContent(response)) as T;
}

describe('IndexedDBDumpHandlers — coverage expansion', () => {
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

  // ── Default args ──

  describe('default arguments', () => {
    it('passes empty database, empty store, and maxRecords 100 by default', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValueOnce({});

      await handlers.handleIndexedDBDump({});

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        database: '',
        store: '',
        maxRecords: 100,
      });
    });
  });

  // ── Explicit args ──

  describe('explicit arguments', () => {
    it('passes explicit database filter', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValueOnce({
        myDb: { users: [{ id: 1 }] },
      });

      const body = parseJson<BrowserStatusResponse>(
        await handlers.handleIndexedDBDump({ database: 'myDb' }),
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        database: 'myDb',
        store: '',
        maxRecords: 100,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.myDb.users).toEqual([{ id: 1 }]);
    });

    it('passes explicit store filter', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValueOnce({
        myDb: { targetStore: [{ key: 'val' }] },
      });

      const body = parseJson<BrowserStatusResponse>(
        await handlers.handleIndexedDBDump({ store: 'targetStore' }),
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        database: '',
        store: 'targetStore',
        maxRecords: 100,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.myDb.targetStore).toEqual([{ key: 'val' }]);
    });

    it('passes explicit maxRecords', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValueOnce({
        db: { store: [{ a: 1 }, { a: 2 }] },
      });

      const body = parseJson<BrowserStatusResponse>(
        await handlers.handleIndexedDBDump({ maxRecords: 2 }),
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        database: '',
        store: '',
        maxRecords: 2,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.db.store).toHaveLength(2);
    });

    it('passes all three arguments together', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValueOnce({
        specificDb: { specificStore: [{ x: 1 }] },
      });

      await handlers.handleIndexedDBDump({
        database: 'specificDb',
        store: 'specificStore',
        maxRecords: 50,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        database: 'specificDb',
        store: 'specificStore',
        maxRecords: 50,
      });
    });
  });

  // ── Multiple databases ──

  describe('multiple databases', () => {
    it('returns data from multiple databases', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValueOnce({
        db1: { users: [{ id: 1 }], settings: [{ key: 'theme', value: 'dark' }] },
        db2: { logs: [{ msg: 'hello' }] },
      });

      const body = parseJson<BrowserStatusResponse>(await handlers.handleIndexedDBDump({}));

      expect(Object.keys(body)).toEqual(['db1', 'db2']);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.db1.users).toHaveLength(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.db1.settings).toHaveLength(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.db2.logs).toHaveLength(1);
    });
  });

  // ── Empty results ──

  describe('empty results', () => {
    it('returns empty object when no databases exist', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValueOnce({});

      const body = parseJson<BrowserStatusResponse>(await handlers.handleIndexedDBDump({}));

      expect(body).toEqual({});
    });

    it('returns database with empty stores', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValueOnce({
        emptyDb: {},
      });

      const body = parseJson<BrowserStatusResponse>(await handlers.handleIndexedDBDump({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.emptyDb).toEqual({});
    });

    it('returns stores with empty arrays', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValueOnce({
        db: { emptyStore: [] },
      });

      const body = parseJson<BrowserStatusResponse>(await handlers.handleIndexedDBDump({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.db.emptyStore).toEqual([]);
    });
  });

  // ── Error from page evaluate ──

  describe('error handling', () => {
    it('returns error payload when page.evaluate rejects with Error', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockRejectedValueOnce(new Error('IndexedDB not available'));

      const body = parseJson<BrowserStatusResponse>(await handlers.handleIndexedDBDump({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toBe('IndexedDB not available');
    });

    it('returns error payload when page.evaluate rejects with string', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockRejectedValueOnce('string error');

      const body = parseJson<BrowserStatusResponse>(await handlers.handleIndexedDBDump({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toBe('string error');
    });

    it('returns error payload when page.evaluate rejects with number', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockRejectedValueOnce(42);

      const body = parseJson<BrowserStatusResponse>(await handlers.handleIndexedDBDump({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toBe('42');
    });

    it('returns error payload when page.evaluate rejects with null', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockRejectedValueOnce(null);

      const body = parseJson<BrowserStatusResponse>(await handlers.handleIndexedDBDump({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toBe('null');
    });

    it('returns error when getActivePage rejects', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      getActivePage.mockRejectedValueOnce(new Error('no browser'));
      handlers = new IndexedDBDumpHandlers({ getActivePage });

      const body = parseJson<BrowserStatusResponse>(await handlers.handleIndexedDBDump({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toBe('no browser');
    });

    it('returns error when getActivePage rejects with non-Error', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      getActivePage.mockRejectedValueOnce('connection lost');
      handlers = new IndexedDBDumpHandlers({ getActivePage });

      const body = parseJson<BrowserStatusResponse>(await handlers.handleIndexedDBDump({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toBe('connection lost');
    });
  });

  // ── Database errors (simulated via evaluate return) ──

  describe('database-level error simulation', () => {
    it('returns __error__ for databases that fail to open', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValueOnce({
        failedDb: { __error__: ['failed to open'] },
        goodDb: { store1: [{ a: 1 }] },
      });

      const body = parseJson<BrowserStatusResponse>(await handlers.handleIndexedDBDump({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.failedDb.__error__).toEqual(['failed to open']);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.goodDb.store1).toEqual([{ a: 1 }]);
    });

    it('returns error string for stores that fail to read', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValueOnce({
        db: {
          goodStore: [{ key: 'val' }],
          badStore: ['__error reading store__'],
        },
      });

      const body = parseJson<BrowserStatusResponse>(await handlers.handleIndexedDBDump({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.db.goodStore).toEqual([{ key: 'val' }]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.db.badStore).toEqual(['__error reading store__']);
    });
  });

  // ── Complex data types ──

  describe('complex data types', () => {
    it('handles nested objects in store records', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValueOnce({
        appDb: {
          config: [
            {
              id: 1,
              settings: {
                theme: { primary: '#000', secondary: '#fff' },
                layout: { sidebar: true, compact: false },
              },
            },
          ],
        },
      });

      const body = parseJson<BrowserStatusResponse>(await handlers.handleIndexedDBDump({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.appDb.config[0].settings.theme.primary).toBe('#000');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.appDb.config[0].settings.layout.sidebar).toBe(true);
    });

    it('handles arrays of various types in records', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValueOnce({
        testDb: {
          mixed: [
            {
              strings: ['a', 'b'],
              numbers: [1, 2, 3],
              booleans: [true, false],
              nested: [{ x: 1 }, { y: 2 }],
            },
          ],
        },
      });

      const body = parseJson<BrowserStatusResponse>(await handlers.handleIndexedDBDump({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.testDb.mixed[0].strings).toEqual(['a', 'b']);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.testDb.mixed[0].numbers).toEqual([1, 2, 3]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.testDb.mixed[0].nested).toEqual([{ x: 1 }, { y: 2 }]);
    });

    it('handles large number of records', async () => {
      const records = Array.from({ length: 100 }, (_, i) => ({ id: i, value: `item-${i}` }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValueOnce({
        largeDb: { bigStore: records },
      });

      const body = parseJson<BrowserStatusResponse>(await handlers.handleIndexedDBDump({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.largeDb.bigStore).toHaveLength(100);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.largeDb.bigStore[99].id).toBe(99);
    });
  });

  // ── Response structure ──

  describe('response structure', () => {
    it('wraps result in content array with type text', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValueOnce({});

      const response = await handlers.handleIndexedDBDump({});
      const first = response.content[0];

      expect(response.content).toHaveLength(1);
      expect(first).toBeDefined();
      expect(first?.type).toBe('text');
      expect(() => JSON.parse(getTextContent(response))).not.toThrow();
    });

    it('wraps error in content array with type text', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockRejectedValueOnce(new Error('fail'));

      const response = await handlers.handleIndexedDBDump({});
      const first = response.content[0];

      expect(response.content).toHaveLength(1);
      expect(first).toBeDefined();
      expect(first?.type).toBe('text');
    });

    it('success result JSON is indented with 2 spaces', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValueOnce({ db: { store: [1] } });

      const response = await handlers.handleIndexedDBDump({});
      const text = getTextContent(response);

      expect(text).toContain('\n  ');
    });

    it('error result JSON is indented with 2 spaces', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockRejectedValueOnce(new Error('err'));

      const response = await handlers.handleIndexedDBDump({});
      const text = getTextContent(response);

      expect(text).toContain('\n  ');
    });
  });

  // ── Partial args coverage ──

  describe('partial arguments', () => {
    it('uses empty string for database when only store is provided', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValueOnce({});

      await handlers.handleIndexedDBDump({ store: 'myStore' });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        database: '',
        store: 'myStore',
        maxRecords: 100,
      });
    });

    it('uses empty string for store when only database is provided', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValueOnce({});

      await handlers.handleIndexedDBDump({ database: 'myDb' });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        database: 'myDb',
        store: '',
        maxRecords: 100,
      });
    });

    it('uses default maxRecords when only database and store are provided', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValueOnce({});

      await handlers.handleIndexedDBDump({ database: 'db', store: 'store' });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        database: 'db',
        store: 'store',
        maxRecords: 100,
      });
    });

    it('uses maxRecords of 1 to get single record', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValueOnce({
        db: { store: [{ only: 'one' }] },
      });

      const body = parseJson<BrowserStatusResponse>(
        await handlers.handleIndexedDBDump({ maxRecords: 1 }),
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        database: '',
        store: '',
        maxRecords: 1,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.db.store).toEqual([{ only: 'one' }]);
    });

    it('uses large maxRecords value', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValueOnce({});

      await handlers.handleIndexedDBDump({ maxRecords: 10000 });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        database: '',
        store: '',
        maxRecords: 10000,
      });
    });
  });

  // ── Multiple stores per database ──

  describe('multiple stores per database', () => {
    it('returns data from all stores within a database', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      page.evaluate.mockResolvedValueOnce({
        appDb: {
          users: [
            { id: 1, name: 'Alice' },
            { id: 2, name: 'Bob' },
          ],
          sessions: [{ sid: 'abc', active: true }],
          settings: [{ key: 'lang', value: 'en' }],
        },
      });

      const body = parseJson<BrowserStatusResponse>(await handlers.handleIndexedDBDump({}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(Object.keys(body.appDb)).toEqual(['users', 'sessions', 'settings']);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.appDb.users).toHaveLength(2);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.appDb.sessions).toHaveLength(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.appDb.settings).toHaveLength(1);
    });
  });
});
