/**
 * Page snapshot capture/restore/list service.
 *
 * Extracted from `CoordinationHandlers` so the coordination domain keeps
 * handoffs/insights and page state has one owner. The two public restore
 * tools (`restore_page_snapshot` and `coordination_restore_snapshot`) now share
 * this implementation; the only difference is whether IndexedDB records are
 * restored.
 */
import { randomUUID } from 'node:crypto';
import { COORDINATION_GOTO_TIMEOUT_MS, COORDINATION_MAX_SNAPSHOTS } from '@src/constants';
import type { PageController } from '@server/domains/shared/modules/collector';
import {
  captureLocalStorage,
  captureSessionStorage,
  INDEXEDDB_CAPTURE_SCRIPT,
  INDEXEDDB_DATA_CAPTURE_SCRIPT,
  restoreIndexedDBData,
  restoreWebStorage,
} from './scripts';
import type {
  IndexedDBDatabaseSummary,
  IndexedDBRecordData,
  PageSnapshot,
  PageSnapshotRestoreResult,
  PageSnapshotSaveResult,
} from './types';

type SnapshotPage = Awaited<ReturnType<PageController['getPage']>>;

export class PageSnapshotService {
  /** Snapshot store. Exposed for the handler's existing test seam. */
  readonly snapshots = new Map<string, PageSnapshot>();
  private readonly getPageController: () => PageController | undefined;

  constructor(getPageController: () => PageController | undefined) {
    this.getPageController = getPageController;
  }

  async save(args: Record<string, unknown>): Promise<PageSnapshotSaveResult> {
    const label = typeof args.label === 'string' ? args.label : undefined;
    const page = await this.requirePage('No active page to snapshot');
    const url = page.url();

    // Capture cookies via CDP
    let cookies: PageSnapshot['cookies'] = [];
    try {
      const cdp = await page.createCDPSession();
      const result = (await cdp.send('Network.getAllCookies')) as {
        cookies: Array<{ name: string; value: string; domain: string; path: string }>;
      };
      cookies = result.cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
      }));
      await cdp.detach();
    } catch {
      // Cookie capture may fail without browser — proceed without
    }

    // Capture storage
    let localStorage: Record<string, string> = {};
    let sessionStorage: Record<string, string> = {};
    try {
      localStorage = await page.evaluate(captureLocalStorage);
      sessionStorage = await page.evaluate(captureSessionStorage);
    } catch {
      // Storage capture may fail on some pages — proceed without
    }

    // Capture IndexedDB metadata (database / store / keyPath / count) for
    // forensic diagnosis. Modern web apps keep auth tokens / draft state in
    // IndexedDB (not localStorage); without this the snapshot misses the
    // dominant "restore logged-in session" surface.
    let indexedDB: IndexedDBDatabaseSummary[] | undefined;
    let indexedDBData: IndexedDBRecordData[] | undefined;
    try {
      const captured = (await page.evaluate(INDEXEDDB_CAPTURE_SCRIPT)) as
        | IndexedDBDatabaseSummary[]
        | null;
      if (Array.isArray(captured) && captured.length > 0) {
        indexedDB = captured;
      }
      // Also capture record data for restore support (limited to 100 records per store)
      const recordData = (await page.evaluate(INDEXEDDB_DATA_CAPTURE_SCRIPT)) as
        | IndexedDBRecordData[]
        | null;
      if (Array.isArray(recordData) && recordData.length > 0) {
        indexedDBData = recordData;
      }
    } catch {
      // IndexedDB capture may fail (no browser / cross-origin) — proceed without
    }

    const snapshot: PageSnapshot = {
      id: randomUUID().slice(0, 8),
      url,
      cookies,
      localStorage,
      sessionStorage,
      ...(indexedDB ? { indexedDB } : {}),
      ...(indexedDBData ? { indexedDBData } : {}),
      timestamp: Date.now(),
      label,
    };

    this.snapshots.set(snapshot.id, snapshot);
    this.trimSnapshots();

    return {
      snapshotId: snapshot.id,
      url: snapshot.url,
      cookieCount: snapshot.cookies.length,
      localStorageKeys: Object.keys(snapshot.localStorage).length,
      sessionStorageKeys: Object.keys(snapshot.sessionStorage).length,
      indexedDBDatabaseCount: snapshot.indexedDB?.length ?? 0,
      indexedDBRecordCount:
        snapshot.indexedDBData?.reduce(
          (sum, r) => sum + (Array.isArray(r.records) ? r.records.length : 0),
          0,
        ) ?? 0,
      label: snapshot.label,
    };
  }

  async restore(
    snapshotId: string,
    options: { includeIndexedDB: boolean },
  ): Promise<PageSnapshotRestoreResult> {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) throw new Error(`Snapshot "${snapshotId}" not found`);

    const page = await this.requirePage('No active page for restoration');

    // Navigate to saved URL
    await page.goto(snapshot.url, {
      waitUntil: 'domcontentloaded',
      timeout: COORDINATION_GOTO_TIMEOUT_MS,
    });

    // Restore cookies via CDP
    let cookiesRestored = 0;
    if (snapshot.cookies.length > 0) {
      try {
        const cdp = await page.createCDPSession();
        await cdp.send('Network.setCookies', {
          cookies: snapshot.cookies.map((c) => ({
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path,
          })),
        });
        await cdp.detach();
        cookiesRestored = snapshot.cookies.length;
      } catch {
        // Cookie restore may fail — proceed
      }
    }

    // Restore localStorage and sessionStorage
    let storageRestored = false;
    try {
      await page.evaluate(restoreWebStorage, snapshot.localStorage, snapshot.sessionStorage);
      storageRestored = true;
    } catch {
      // Storage restore may fail on some pages
    }

    // Restore IndexedDB data
    let indexedDBRestored = false;
    let indexedDBRecordsRestored = 0;
    if (options.includeIndexedDB && snapshot.indexedDBData && snapshot.indexedDBData.length > 0) {
      try {
        const dataJson = JSON.stringify({
          records: snapshot.indexedDBData,
          schemas: snapshot.indexedDB ?? [],
        });
        const restored = await page.evaluate(restoreIndexedDBData, dataJson);
        indexedDBRestored = restored.restored;
        indexedDBRecordsRestored = restored.recordCount;
      } catch {
        // IndexedDB restore may fail — proceed
      }
    }

    return {
      restored: true,
      snapshotId: snapshot.id,
      url: snapshot.url,
      cookieCount: snapshot.cookies.length,
      cookiesRestored,
      localStorageKeys: Object.keys(snapshot.localStorage).length,
      sessionStorageKeys: Object.keys(snapshot.sessionStorage).length,
      storageRestored,
      indexedDBRestored,
      indexedDBRecordsRestored,
    };
  }

  list(): {
    snapshots: Array<{
      id: string;
      url: string;
      label?: string;
      cookieCount: number;
      localStorageKeys: number;
      sessionStorageKeys: number;
      indexedDBDatabaseCount: number;
      indexedDBRecordCount: number;
      createdAt: string;
    }>;
    total: number;
  } {
    const list = [...this.snapshots.values()].map((s) => ({
      id: s.id,
      url: s.url,
      label: s.label,
      cookieCount: s.cookies.length,
      localStorageKeys: Object.keys(s.localStorage).length,
      sessionStorageKeys: Object.keys(s.sessionStorage).length,
      indexedDBDatabaseCount: s.indexedDB?.length ?? 0,
      indexedDBRecordCount:
        s.indexedDBData?.reduce(
          (sum, r) => sum + (Array.isArray(r.records) ? r.records.length : 0),
          0,
        ) ?? 0,
      createdAt: new Date(s.timestamp).toISOString(),
    }));

    return { snapshots: list, total: list.length };
  }

  private async requirePage(noPageMessage: string): Promise<SnapshotPage> {
    const pageController = this.getPageController();
    if (!pageController) throw new Error('No page controller available');

    const page = await pageController.getPage();
    if (!page) throw new Error(noPageMessage);
    return page;
  }

  /** Drop the oldest (by timestamp) snapshots until the Map fits the configured cap. */
  private trimSnapshots(): void {
    if (this.snapshots.size <= COORDINATION_MAX_SNAPSHOTS) return;
    const entries = [...this.snapshots.entries()].toSorted(
      (a, b) => a[1].timestamp - b[1].timestamp,
    );
    const excess = entries.length - COORDINATION_MAX_SNAPSHOTS;
    for (const [id] of entries.slice(0, excess)) {
      this.snapshots.delete(id);
    }
  }
}
