interface IndexedDBDumpHandlersDeps {
  getActivePage: () => Promise<any>;
}

export class IndexedDBDumpHandlers {
  constructor(private deps: IndexedDBDumpHandlersDeps) {}

  async handleIndexedDBDump(args: Record<string, unknown>) {
    const database = (args.database as string | undefined) ?? '';
    const store = (args.store as string | undefined) ?? '';
    const maxRecords = (args.maxRecords as number | undefined) ?? 100;

    try {
      const page = await this.deps.getActivePage();
      const result = await page.evaluate(
        async (opts: { database: string; store: string; maxRecords: number }) => {
          const dbList = await indexedDB.databases();
          const output: Record<string, Record<string, unknown[]>> = {};

          const openDb = (name: string, version?: number): Promise<IDBDatabase> =>
            new Promise((resolve, reject) => {
              const req = version ? indexedDB.open(name, version) : indexedDB.open(name);
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => reject(req.error);
            });

          const getAllFromStore = (
            db: IDBDatabase,
            storeName: string,
            max: number
          ): Promise<unknown[]> =>
            new Promise((resolve, reject) => {
              try {
                const tx = db.transaction(storeName, 'readonly');
                const req = tx.objectStore(storeName).getAll();
                req.onsuccess = () =>
                  resolve((req.result as unknown[]).slice(0, max));
                req.onerror = () => reject(req.error);
              } catch (e) {
                reject(e);
              }
            });

          for (const dbInfo of dbList) {
            if (!dbInfo.name) continue;
            if (opts.database && dbInfo.name !== opts.database) continue;

            let db: IDBDatabase;
            try {
              db = await openDb(dbInfo.name, dbInfo.version);
            } catch {
              output[dbInfo.name] = { __error__: ['failed to open'] };
              continue;
            }

            const storeNames = Array.from(db.objectStoreNames);
            const dbData: Record<string, unknown[]> = {};

            for (const storeName of storeNames) {
              if (opts.store && storeName !== opts.store) continue;
              try {
                dbData[storeName] = await getAllFromStore(
                  db,
                  storeName,
                  opts.maxRecords
                );
              } catch {
                dbData[storeName] = ['__error reading store__'];
              }
            }

            db.close();
            output[dbInfo.name] = dbData;
          }

          return output;
        },
        { database, store, maxRecords }
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: error instanceof Error ? error.message : String(error),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }
}
