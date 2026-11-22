/**
 * Page-side functions and serialized scripts used by page snapshots.
 *
 * Everything in this file must stay self-contained: these functions are passed
 * to `page.evaluate()` and serialized with `Function.prototype.toString()`.
 * Do not add imports or references to Node-side modules here.
 */

/**
 * In-page IndexedDB metadata capture, run via `page.evaluate(string)`. Returns
 * database → store summaries (name / count / keyPath). Serialized as a string
 * so it carries no Node-side type/lint surface and runs self-contained in the
 * page. Uses `indexedDB.databases()` (Chromium 71+); older browsers return [].
 * Fail-soft: an unopenable DB (cross-origin / blocked) is surfaced with
 * `{ name, error }` rather than aborting the whole capture.
 */
export const INDEXEDDB_CAPTURE_SCRIPT = `(async () => {
  const idb = globalThis.indexedDB;
  if (!idb) return [];
  let dbs = [];
  try { if (typeof idb.databases === 'function') dbs = await idb.databases(); } catch (e) {}
  const out = [];
  for (const info of dbs) {
    const name = info && info.name;
    if (typeof name !== 'string') continue;
    try {
      const db = await new Promise((resolve, reject) => {
        const r = idb.open(name);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const storeNames = Array.from(db.objectStoreNames);
      const stores = [];
      if (storeNames.length) {
        await new Promise((resolve) => {
          const tx = db.transaction(storeNames, 'readonly');
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
          for (const sn of storeNames) {
            const s = tx.objectStore(sn);
            const c = s.count();
            c.onsuccess = () => {
              const kp = s.keyPath;
              const base = { name: sn, count: c.result, autoIncrement: s.autoIncrement };
              stores.push(kp === null || kp === undefined ? base : { ...base, keyPath: kp });
            };
            c.onerror = () => stores.push({ name: sn, count: 0 });
          }
        });
      }
      const version = typeof db.version === 'number' ? db.version : undefined;
      db.close();
      out.push(version === undefined ? { name, stores } : { name, version, stores });
    } catch (e) {
      out.push({ name, error: (e && e.message) ? String(e.message) : 'open-failed' });
    }
  }
  return out;
})()`;

/**
 * In-page IndexedDB record data capture. Opens each database and reads up to
 * MAX_RECORDS_PER_STORE records from each object store. Returns an array of
 * { database, store, records } objects suitable for serialization.
 */
export const INDEXEDDB_DATA_CAPTURE_SCRIPT = `(async () => {
  const MAX_RECORDS_PER_STORE = 100;
  const idb = globalThis.indexedDB;
  if (!idb) return [];
  let dbs = [];
  try { if (typeof idb.databases === 'function') dbs = await idb.databases(); } catch (e) {}
  const out = [];
  for (const info of dbs) {
    const name = info && info.name;
    if (typeof name !== 'string') continue;
    try {
      const db = await new Promise((resolve, reject) => {
        const r = idb.open(name);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const storeNames = Array.from(db.objectStoreNames);
      for (const sn of storeNames) {
        try {
          const records = [];
          let count = 0;
          await new Promise((resolve) => {
            const tx = db.transaction(sn, 'readonly');
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
            tx.onabort = () => resolve();
            const store = tx.objectStore(sn);
            const cursorReq = store.openCursor();
            cursorReq.onsuccess = (event) => {
              const cursor = event.target.result;
              if (cursor && count < MAX_RECORDS_PER_STORE) {
                try {
                  records.push({ key: JSON.parse(JSON.stringify(cursor.key)), value: JSON.parse(JSON.stringify(cursor.value)) });
                } catch (e) {
                  records.push({ key: String(cursor.key), value: '<non-serializable>' });
                }
                count++;
                cursor.continue();
              }
            };
          });
          if (records.length > 0) {
            out.push({ database: name, store: sn, records });
          }
        } catch (e) {
          // skip unreadable stores
        }
      }
      db.close();
    } catch (e) {
      // skip unopenable databases
    }
  }
  return out;
})()`;

/** Page-side localStorage capture. Self-contained for `page.evaluate`. */
export function captureLocalStorage(): Record<string, string> {
  const ls: Record<string, string> = {};
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (key) ls[key] = window.localStorage.getItem(key) ?? '';
  }
  return ls;
}

/** Page-side sessionStorage capture. Self-contained for `page.evaluate`. */
export function captureSessionStorage(): Record<string, string> {
  const ss: Record<string, string> = {};
  for (let i = 0; i < window.sessionStorage.length; i++) {
    const key = window.sessionStorage.key(i);
    if (key) ss[key] = window.sessionStorage.getItem(key) ?? '';
  }
  return ss;
}

/** Page-side localStorage/sessionStorage restore. Self-contained for `page.evaluate`. */
export function restoreWebStorage(ls: Record<string, string>, ss: Record<string, string>): void {
  window.localStorage.clear();
  for (const [k, v] of Object.entries(ls)) {
    window.localStorage.setItem(k, v);
  }
  window.sessionStorage.clear();
  for (const [k, v] of Object.entries(ss)) {
    window.sessionStorage.setItem(k, v);
  }
}

/**
 * Page-side IndexedDB restore. Self-contained for `page.evaluate(fn, json)`.
 *
 * Expects `{ records, schemas }` JSON. Deletes each existing database, recreates
 * the captured schema (including out-of-line keys), and re-adds records.
 */
export async function restoreIndexedDBData(
  json: string,
): Promise<{ restored: boolean; recordCount: number }> {
  const idb = (globalThis as Record<string, unknown>).indexedDB as IDBFactory | undefined;
  if (!idb) return { restored: false, recordCount: 0 };
  const captured = JSON.parse(json) as {
    records: Array<{
      database?: string;
      store?: string;
      records?: Array<{ key: unknown; value: unknown }>;
    }>;
    schemas: Array<{
      name: string;
      version?: number;
      stores?: Array<{
        name: string;
        keyPath?: string | string[];
        autoIncrement?: boolean;
      }>;
    }>;
  };
  const data = captured.records;
  if (!Array.isArray(data) || data.length === 0) return { restored: false, recordCount: 0 };

  // Group by database
  const dbMap = new Map<
    string,
    Array<{ store: string; records: Array<{ key: unknown; value: unknown }> }>
  >();
  for (const entry of data) {
    if (!entry.database || !entry.store || !Array.isArray(entry.records)) continue;
    if (!dbMap.has(entry.database)) dbMap.set(entry.database, []);
    dbMap.get(entry.database)!.push({ store: entry.store, records: entry.records });
  }

  let totalRecords = 0;
  for (const [dbName, entries] of dbMap) {
    try {
      // Delete existing
      await new Promise<void>((resolve, reject) => {
        const delReq = idb.deleteDatabase(dbName);
        // eslint-disable-next-line unicorn/prefer-add-event-listener
        delReq.onsuccess = () => resolve();
        // eslint-disable-next-line unicorn/prefer-add-event-listener
        delReq.onerror = () => reject(delReq.error);
        // eslint-disable-next-line unicorn/prefer-add-event-listener
        delReq.onblocked = () => reject(new Error(`Deletion blocked for ${dbName}`));
      });

      // Create and populate
      await new Promise<void>((resolve, reject) => {
        const schema = captured.schemas.find((item) => item.name === dbName);
        const openReq = idb.open(dbName, schema?.version ?? 1);
        openReq.onupgradeneeded = () => {
          const db = openReq.result;
          for (const entry of entries) {
            if (!db.objectStoreNames.contains(entry.store)) {
              const storeSchema = schema?.stores?.find((item) => item.name === entry.store);
              db.createObjectStore(entry.store, {
                ...(storeSchema?.keyPath !== undefined ? { keyPath: storeSchema.keyPath } : {}),
                autoIncrement: storeSchema?.autoIncrement ?? false,
              });
            }
          }
        };
        openReq.onsuccess = async () => {
          const db = openReq.result;
          for (const entry of entries) {
            try {
              await new Promise<void>((resolveStore) => {
                const tx = db.transaction(entry.store, 'readwrite');
                // eslint-disable-next-line unicorn/prefer-add-event-listener
                tx.oncomplete = () => resolveStore();
                // eslint-disable-next-line unicorn/prefer-add-event-listener
                tx.onerror = () => resolveStore();
                // eslint-disable-next-line unicorn/prefer-add-event-listener
                tx.onabort = () => resolveStore();
                const store = tx.objectStore(entry.store);
                for (const rec of entry.records) {
                  try {
                    if (store.keyPath === null) store.add(rec.value, rec.key as IDBValidKey);
                    else store.add(rec.value);
                    totalRecords++;
                  } catch {
                    /* skip */
                  }
                }
              });
            } catch {
              /* skip store */
            }
          }
          db.close();
          resolve();
        };
        // eslint-disable-next-line unicorn/prefer-add-event-listener
        openReq.onerror = () => reject(openReq.error);
      });
    } catch {
      /* skip db */
    }
  }
  return { restored: totalRecords > 0, recordCount: totalRecords };
}
