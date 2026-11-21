/** Serialized page-snapshot shapes shared by the service and its handlers. */

export interface IndexedDBStoreSummary {
  name: string;
  count: number;
  keyPath?: string | string[];
  autoIncrement?: boolean;
}

export interface IndexedDBDatabaseSummary {
  name: string;
  version?: number;
  stores?: IndexedDBStoreSummary[];
  /** Present when a database is listed but cannot be opened (cross-origin / blocked). */
  error?: string;
}

export interface IndexedDBRecordData {
  database: string;
  store: string;
  key: unknown;
  value: unknown;
  records: Array<{ key: unknown; value: unknown }>;
}

export interface PageSnapshot {
  id: string;
  url: string;
  cookies: Array<{ name: string; value: string; domain: string; path: string }>;
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
  /** IndexedDB metadata (database / store / keyPath / count) captured for forensic diagnosis. */
  indexedDB?: IndexedDBDatabaseSummary[];
  /**
   * Captured IndexedDB record data for snapshot restore. Limited to 100 records
   * per store to bound memory usage. Stored as serializable JSON-safe values.
   */
  indexedDBData?: IndexedDBRecordData[];
  timestamp: number;
  label?: string;
}

export interface PageSnapshotSaveResult {
  snapshotId: string;
  url: string;
  cookieCount: number;
  localStorageKeys: number;
  sessionStorageKeys: number;
  indexedDBDatabaseCount: number;
  indexedDBRecordCount: number;
  label?: string;
}

export interface PageSnapshotRestoreResult {
  restored: true;
  snapshotId: string;
  url: string;
  /** Number of cookies present in the snapshot (attempted restore). */
  cookieCount: number;
  /** Number of cookies actually restored; 0 when CDP failed. */
  cookiesRestored: number;
  localStorageKeys: number;
  sessionStorageKeys: number;
  /** Whether the localStorage/sessionStorage write completed without error. */
  storageRestored: boolean;
  indexedDBRestored: boolean;
  indexedDBRecordsRestored: number;
}
