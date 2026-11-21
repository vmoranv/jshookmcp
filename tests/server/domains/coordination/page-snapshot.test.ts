import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CoordinationHandlers } from '@server/domains/coordination/index';
import { TEST_URLS, withPath } from '@tests/shared/test-urls';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('CoordinationHandlers — page snapshots (IndexedDB capture)', () => {
  const pageController: any = { getPage: vi.fn() };
  let handlers: CoordinationHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new CoordinationHandlers({ pageController } as any);
  });

  function makePage(opts: { idb: unknown; cookies?: unknown[] }) {
    return {
      url: () => withPath(TEST_URLS.root, 'app'),
      goto: vi.fn(),
      createCDPSession: vi.fn().mockResolvedValue({
        send: vi.fn().mockResolvedValue({ cookies: opts.cookies ?? [] }),
        detach: vi.fn(),
      }),
      evaluate: vi.fn().mockImplementation((arg: unknown) => {
        // The IndexedDB probe is sent as a serialized string; localStorage and
        // sessionStorage captures are sent as functions. Route accordingly.
        if (typeof arg === 'string') return Promise.resolve(opts.idb);
        return Promise.resolve({});
      }),
    };
  }

  it('save_page_snapshot captures IndexedDB metadata when present', async () => {
    const idb = [
      {
        name: 'authDB',
        version: 1,
        stores: [{ name: 'tokens', count: 3, keyPath: 'id' }],
      },
    ];
    pageController.getPage.mockResolvedValue(makePage({ idb }));

    const res = (await handlers.handleSavePageSnapshot({
      label: 'with-idb',
    })) as Record<string, unknown>;

    expect(res.snapshotId).toBeDefined();
    expect(res.indexedDBDatabaseCount).toBe(1);
    expect(res.url).toBe(withPath(TEST_URLS.root, 'app'));
  });

  it('save_page_snapshot captures multiple IndexedDB databases', async () => {
    const idb = [
      { name: 'cacheDb', stores: [{ name: 'responses', count: 12 }] },
      { name: 'firebaseDb', version: 4, stores: [{ name: 'users', count: 2 }] },
    ];
    pageController.getPage.mockResolvedValue(makePage({ idb }));

    const res = (await handlers.handleSavePageSnapshot({})) as Record<string, unknown>;

    expect(res.indexedDBDatabaseCount).toBe(2);
  });

  it('save_page_snapshot proceeds without IndexedDB (null capture)', async () => {
    pageController.getPage.mockResolvedValue(makePage({ idb: null }));

    const res = (await handlers.handleSavePageSnapshot({
      label: 'no-idb',
    })) as Record<string, unknown>;

    expect(res.snapshotId).toBeDefined();
    expect(res.indexedDBDatabaseCount).toBe(0);
  });

  it('save_page_snapshot is resilient when IndexedDB capture throws (cross-origin)', async () => {
    const page = makePage({ idb: [] });
    page.evaluate.mockImplementation((arg: unknown) => {
      if (typeof arg === 'string') return Promise.reject(new Error('cross-origin blocked'));
      return Promise.resolve({});
    });
    pageController.getPage.mockResolvedValue(page);

    const res = (await handlers.handleSavePageSnapshot({})) as Record<string, unknown>;

    expect(res.snapshotId).toBeDefined();
    expect(res.indexedDBDatabaseCount).toBe(0);
  });

  it('restore_page_snapshot keeps the legacy response shape and skips IndexedDB', async () => {
    const page = makePage({ idb: [] });
    pageController.getPage.mockResolvedValue(page);
    const snapshotId = 'legacy-shape';
    (handlers as any).pageSnapshots.snapshots.set(snapshotId, {
      id: snapshotId,
      url: withPath(TEST_URLS.root, 'app'),
      cookies: [{ name: 'sid', value: '1', domain: 'example.test', path: '/' }],
      localStorage: { a: '1' },
      sessionStorage: { b: '2' },
      indexedDB: [{ name: 'authDB', version: 1, stores: [{ name: 'tokens' }] }],
      indexedDBData: [
        { database: 'authDB', store: 'tokens', records: [{ key: 1, value: { token: 'x' } }] },
      ],
      timestamp: Date.now(),
    });

    const result = (await handlers.handleRestorePageSnapshot({ snapshotId })) as Record<
      string,
      unknown
    >;

    expect(result).toEqual({
      restored: true,
      snapshotId,
      url: withPath(TEST_URLS.root, 'app'),
      cookiesRestored: 1,
      localStorageKeysRestored: 1,
      sessionStorageKeysRestored: 1,
    });
    // Only the web-storage restore is sent to the page; IndexedDB is skipped.
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });

  it('does not open a replacement database when deletion is blocked', async () => {
    const open = vi.fn();
    const deleteDatabase = vi.fn(() => {
      const request: any = {};
      queueMicrotask(() => request.onblocked?.());
      return request;
    });
    vi.stubGlobal('indexedDB', { deleteDatabase, open });

    const page: any = {
      goto: vi.fn(),
      createCDPSession: vi.fn(),
      evaluate: vi.fn(async (fn: any, ...args: unknown[]) => {
        if (typeof args[0] === 'string') return fn(args[0]);
        return {};
      }),
    };
    pageController.getPage.mockResolvedValue(page);
    (handlers as any).pageSnapshots.snapshots.set('blocked', {
      id: 'blocked',
      url: withPath(TEST_URLS.root, 'app'),
      cookies: [],
      localStorage: {},
      sessionStorage: {},
      indexedDB: [{ name: 'authDB', version: 1, stores: [{ name: 'tokens' }] }],
      indexedDBData: [
        { database: 'authDB', store: 'tokens', records: [{ key: 1, value: { token: 'x' } }] },
      ],
      timestamp: Date.now(),
    });

    try {
      const result = (await handlers.handleCoordinationRestoreSnapshot({
        snapshotId: 'blocked',
      })) as Record<string, unknown>;

      expect(deleteDatabase).toHaveBeenCalledWith('authDB');
      expect(open).not.toHaveBeenCalled();
      expect(result.indexedDBRestored).toBe(false);
      expect(result.indexedDBRecordsRestored).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('recreates IndexedDB schemas and restores out-of-line keys', async () => {
    const createObjectStore = vi.fn();
    const outOfLineAdd = vi.fn();
    const inlineAdd = vi.fn();
    const transaction = vi.fn((storeName: string) => {
      const tx: any = {
        objectStore: () =>
          storeName === 'by-id'
            ? { keyPath: null, add: outOfLineAdd }
            : { keyPath: 'id', add: inlineAdd },
      };
      queueMicrotask(() => tx.oncomplete?.());
      return tx;
    });
    const db = {
      objectStoreNames: { contains: vi.fn(() => false) },
      createObjectStore,
      transaction,
      close: vi.fn(),
    };
    const deleteDatabase = vi.fn(() => {
      const request: any = {};
      queueMicrotask(() => request.onsuccess?.());
      return request;
    });
    const open = vi.fn(() => {
      const request: any = { result: db };
      queueMicrotask(() => {
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    });
    vi.stubGlobal('indexedDB', { deleteDatabase, open });

    const page: any = {
      goto: vi.fn(),
      createCDPSession: vi.fn(),
      evaluate: vi.fn(async (fn: any, ...args: unknown[]) => {
        if (typeof args[0] === 'string') return fn(args[0]);
        return {};
      }),
    };
    pageController.getPage.mockResolvedValue(page);
    (handlers as any).pageSnapshots.snapshots.set('schema-keys', {
      id: 'schema-keys',
      url: withPath(TEST_URLS.root, 'app'),
      cookies: [],
      localStorage: {},
      sessionStorage: {},
      indexedDB: [
        {
          name: 'authDB',
          version: 4,
          stores: [
            { name: 'by-id', autoIncrement: false },
            { name: 'inline', keyPath: 'id', autoIncrement: false },
          ],
        },
      ],
      indexedDBData: [
        { database: 'authDB', store: 'by-id', records: [{ key: 7, value: { token: 'x' } }] },
        { database: 'authDB', store: 'inline', records: [{ key: 9, value: { id: 9 } }] },
      ],
      timestamp: Date.now(),
    });

    try {
      const result = (await handlers.handleCoordinationRestoreSnapshot({
        snapshotId: 'schema-keys',
      })) as Record<string, unknown>;

      expect(open).toHaveBeenCalledWith('authDB', 4);
      expect(createObjectStore).toHaveBeenCalledWith('by-id', { autoIncrement: false });
      expect(createObjectStore).toHaveBeenCalledWith('inline', {
        keyPath: 'id',
        autoIncrement: false,
      });
      expect(outOfLineAdd).toHaveBeenCalledWith({ token: 'x' }, 7);
      expect(inlineAdd).toHaveBeenCalledWith({ id: 9 });
      expect(result.indexedDBRestored).toBe(true);
      expect(result.indexedDBRecordsRestored).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
