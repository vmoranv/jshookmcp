import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { IndexedDBDumpHandlers } from '@server/domains/browser/handlers/indexeddb-dump';

type EvaluateFn = (pageFunction: unknown, ...args: unknown[]) => Promise<unknown>;
type GetActivePageFn = () => Promise<unknown>;
type IndexedDBDumpResponse = Awaited<ReturnType<IndexedDBDumpHandlers['handleIndexedDBDump']>>;

function getTextContent(response: IndexedDBDumpResponse): string {
  const first = response.content[0];
  expect(first).toBeDefined();
  expect(first?.type).toBe('text');
  if (!first || first.type !== 'text') {
    throw new Error('Expected text tool response');
  }
  return first.text;
}

function parseJson(response: IndexedDBDumpResponse): any {
  return JSON.parse(getTextContent(response));
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
      page.evaluate.mockResolvedValueOnce({});

      await handlers.handleIndexedDBDump({});

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
      page.evaluate.mockResolvedValueOnce({
        myDb: { users: [{ id: 1 }] },
      });

      const body = parseJson(await handlers.handleIndexedDBDump({ database: 'myDb' }));

      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        database: 'myDb',
        store: '',
        maxRecords: 100,
      });
      expect(body.myDb.users).toEqual([{ id: 1 }]);
    });

    it('passes explicit store filter', async () => {
      page.evaluate.mockResolvedValueOnce({
        myDb: { targetStore: [{ key: 'val' }] },
      });

      const body = parseJson(await handlers.handleIndexedDBDump({ store: 'targetStore' }));

      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        database: '',
        store: 'targetStore',
        maxRecords: 100,
      });
      expect(body.myDb.targetStore).toEqual([{ key: 'val' }]);
    });

    it('passes explicit maxRecords', async () => {
      page.evaluate.mockResolvedValueOnce({
        db: { store: [{ a: 1 }, { a: 2 }] },
      });

      const body = parseJson(await handlers.handleIndexedDBDump({ maxRecords: 2 }));

      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        database: '',
        store: '',
        maxRecords: 2,
      });
      expect(body.db.store).toHaveLength(2);
    });

    it('passes all three arguments together', async () => {
      page.evaluate.mockResolvedValueOnce({
        specificDb: { specificStore: [{ x: 1 }] },
      });

      await handlers.handleIndexedDBDump({
        database: 'specificDb',
        store: 'specificStore',
        maxRecords: 50,
      });

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
      page.evaluate.mockResolvedValueOnce({
        db1: { users: [{ id: 1 }], settings: [{ key: 'theme', value: 'dark' }] },
        db2: { logs: [{ msg: 'hello' }] },
      });

      const body = parseJson(await handlers.handleIndexedDBDump({}));

      expect(Object.keys(body)).toEqual(['db1', 'db2']);
      expect(body.db1.users).toHaveLength(1);
      expect(body.db1.settings).toHaveLength(1);
      expect(body.db2.logs).toHaveLength(1);
    });
  });

  // ── Empty results ──

  describe('empty results', () => {
    it('returns empty object when no databases exist', async () => {
      page.evaluate.mockResolvedValueOnce({});

      const body = parseJson(await handlers.handleIndexedDBDump({}));

      expect(body).toEqual({});
    });

    it('returns database with empty stores', async () => {
      page.evaluate.mockResolvedValueOnce({
        emptyDb: {},
      });

      const body = parseJson(await handlers.handleIndexedDBDump({}));

      expect(body.emptyDb).toEqual({});
    });

    it('returns stores with empty arrays', async () => {
      page.evaluate.mockResolvedValueOnce({
        db: { emptyStore: [] },
      });

      const body = parseJson(await handlers.handleIndexedDBDump({}));

      expect(body.db.emptyStore).toEqual([]);
    });
  });

  // ── Error from page evaluate ──

  describe('error handling', () => {
    it('returns error payload when page.evaluate rejects with Error', async () => {
      page.evaluate.mockRejectedValueOnce(new Error('IndexedDB not available'));

      const body = parseJson(await handlers.handleIndexedDBDump({}));

      expect(body.success).toBe(false);
      expect(body.error).toBe('IndexedDB not available');
    });

    it('returns error payload when page.evaluate rejects with string', async () => {
      page.evaluate.mockRejectedValueOnce('string error');

      const body = parseJson(await handlers.handleIndexedDBDump({}));

      expect(body.success).toBe(false);
      expect(body.error).toBe('string error');
    });

    it('returns error payload when page.evaluate rejects with number', async () => {
      page.evaluate.mockRejectedValueOnce(42);

      const body = parseJson(await handlers.handleIndexedDBDump({}));

      expect(body.success).toBe(false);
      expect(body.error).toBe('42');
    });

    it('returns error payload when page.evaluate rejects with null', async () => {
      page.evaluate.mockRejectedValueOnce(null);

      const body = parseJson(await handlers.handleIndexedDBDump({}));

      expect(body.success).toBe(false);
      expect(body.error).toBe('null');
    });

    it('returns error when getActivePage rejects', async () => {
      getActivePage.mockRejectedValueOnce(new Error('no browser'));
      handlers = new IndexedDBDumpHandlers({ getActivePage });

      const body = parseJson(await handlers.handleIndexedDBDump({}));

      expect(body.success).toBe(false);
      expect(body.error).toBe('no browser');
    });

    it('returns error when getActivePage rejects with non-Error', async () => {
      getActivePage.mockRejectedValueOnce('connection lost');
      handlers = new IndexedDBDumpHandlers({ getActivePage });

      const body = parseJson(await handlers.handleIndexedDBDump({}));

      expect(body.success).toBe(false);
      expect(body.error).toBe('connection lost');
    });
  });

  // ── Database errors (simulated via evaluate return) ──

  describe('database-level error simulation', () => {
    it('returns __error__ for databases that fail to open', async () => {
      page.evaluate.mockResolvedValueOnce({
        failedDb: { __error__: ['failed to open'] },
        goodDb: { store1: [{ a: 1 }] },
      });

      const body = parseJson(await handlers.handleIndexedDBDump({}));

      expect(body.failedDb.__error__).toEqual(['failed to open']);
      expect(body.goodDb.store1).toEqual([{ a: 1 }]);
    });

    it('returns error string for stores that fail to read', async () => {
      page.evaluate.mockResolvedValueOnce({
        db: {
          goodStore: [{ key: 'val' }],
          badStore: ['__error reading store__'],
        },
      });

      const body = parseJson(await handlers.handleIndexedDBDump({}));

      expect(body.db.goodStore).toEqual([{ key: 'val' }]);
      expect(body.db.badStore).toEqual(['__error reading store__']);
    });
  });

  // ── Complex data types ──

  describe('complex data types', () => {
    it('handles nested objects in store records', async () => {
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

      const body = parseJson(await handlers.handleIndexedDBDump({}));

      expect(body.appDb.config[0].settings.theme.primary).toBe('#000');
      expect(body.appDb.config[0].settings.layout.sidebar).toBe(true);
    });

    it('handles arrays of various types in records', async () => {
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

      const body = parseJson(await handlers.handleIndexedDBDump({}));

      expect(body.testDb.mixed[0].strings).toEqual(['a', 'b']);
      expect(body.testDb.mixed[0].numbers).toEqual([1, 2, 3]);
      expect(body.testDb.mixed[0].nested).toEqual([{ x: 1 }, { y: 2 }]);
    });

    it('handles large number of records', async () => {
      const records = Array.from({ length: 100 }, (_, i) => ({ id: i, value: `item-${i}` }));
      page.evaluate.mockResolvedValueOnce({
        largeDb: { bigStore: records },
      });

      const body = parseJson(await handlers.handleIndexedDBDump({}));

      expect(body.largeDb.bigStore).toHaveLength(100);
      expect(body.largeDb.bigStore[99].id).toBe(99);
    });
  });

  // ── Response structure ──

  describe('response structure', () => {
    it('wraps result in content array with type text', async () => {
      page.evaluate.mockResolvedValueOnce({});

      const response = await handlers.handleIndexedDBDump({});
      const first = response.content[0];

      expect(response.content).toHaveLength(1);
      expect(first).toBeDefined();
      expect(first?.type).toBe('text');
      expect(() => JSON.parse(getTextContent(response))).not.toThrow();
    });

    it('wraps error in content array with type text', async () => {
      page.evaluate.mockRejectedValueOnce(new Error('fail'));

      const response = await handlers.handleIndexedDBDump({});
      const first = response.content[0];

      expect(response.content).toHaveLength(1);
      expect(first).toBeDefined();
      expect(first?.type).toBe('text');
    });

    it('success result JSON is indented with 2 spaces', async () => {
      page.evaluate.mockResolvedValueOnce({ db: { store: [1] } });

      const response = await handlers.handleIndexedDBDump({});
      const text = getTextContent(response);

      expect(text).toContain('\n  ');
    });

    it('error result JSON is indented with 2 spaces', async () => {
      page.evaluate.mockRejectedValueOnce(new Error('err'));

      const response = await handlers.handleIndexedDBDump({});
      const text = getTextContent(response);

      expect(text).toContain('\n  ');
    });
  });

  // ── Partial args coverage ──

  describe('partial arguments', () => {
    it('uses empty string for database when only store is provided', async () => {
      page.evaluate.mockResolvedValueOnce({});

      await handlers.handleIndexedDBDump({ store: 'myStore' });

      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        database: '',
        store: 'myStore',
        maxRecords: 100,
      });
    });

    it('uses empty string for store when only database is provided', async () => {
      page.evaluate.mockResolvedValueOnce({});

      await handlers.handleIndexedDBDump({ database: 'myDb' });

      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        database: 'myDb',
        store: '',
        maxRecords: 100,
      });
    });

    it('uses default maxRecords when only database and store are provided', async () => {
      page.evaluate.mockResolvedValueOnce({});

      await handlers.handleIndexedDBDump({ database: 'db', store: 'store' });

      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        database: 'db',
        store: 'store',
        maxRecords: 100,
      });
    });

    it('uses maxRecords of 1 to get single record', async () => {
      page.evaluate.mockResolvedValueOnce({
        db: { store: [{ only: 'one' }] },
      });

      const body = parseJson(await handlers.handleIndexedDBDump({ maxRecords: 1 }));

      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        database: '',
        store: '',
        maxRecords: 1,
      });
      expect(body.db.store).toEqual([{ only: 'one' }]);
    });

    it('uses large maxRecords value', async () => {
      page.evaluate.mockResolvedValueOnce({});

      await handlers.handleIndexedDBDump({ maxRecords: 10000 });

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

      const body = parseJson(await handlers.handleIndexedDBDump({}));

      expect(Object.keys(body.appDb)).toEqual(['users', 'sessions', 'settings']);
      expect(body.appDb.users).toHaveLength(2);
      expect(body.appDb.sessions).toHaveLength(1);
      expect(body.appDb.settings).toHaveLength(1);
    });
  });
});
