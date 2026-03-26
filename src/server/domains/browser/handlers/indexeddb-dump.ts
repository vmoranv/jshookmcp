interface EvaluatablePage {
  evaluate(pageFunction: unknown, ...args: unknown[]): Promise<unknown>;
}

interface IndexedDBDumpHandlersDeps {
  getActivePage: () => Promise<unknown>;
}

import { argString, argNumber } from '@server/domains/shared/parse-args';

export class IndexedDBDumpHandlers {
  constructor(private deps: IndexedDBDumpHandlersDeps) {}

  async handleIndexedDBDump(args: Record<string, unknown>) {
    const database = argString(args, 'database', '');
    const store = argString(args, 'store', '');
    const maxRecords = argNumber(args, 'maxRecords', 100);

    try {
      const page = (await this.deps.getActivePage()) as EvaluatablePage;
      const result = await page.evaluate(
        async (opts: { database: string; store: string; maxRecords: number }) => {
          const dbList = await indexedDB.databases();
          const output: Record<string, Record<string, unknown[]>> = {};

          for (const dbInfo of dbList) {
            if (!dbInfo.name) continue;
            if (opts.database && dbInfo.name !== opts.database) continue;

            let db: IDBDatabase;
            try {
              db = await new Promise((resolve, reject) => {
                const req = dbInfo.version
                  ? indexedDB.open(dbInfo.name, dbInfo.version)
                  : indexedDB.open(dbInfo.name);
                req.addEventListener('success', () => resolve(req.result), { once: true });
                req.addEventListener('error', () => reject(req.error), { once: true });
              });
            } catch {
              output[dbInfo.name] = { __error__: ['failed to open'] };
              continue;
            }

            const storeNames = Array.from(db.objectStoreNames);
            const dbData: Record<string, unknown[]> = {};

            for (const storeName of storeNames) {
              if (opts.store && storeName !== opts.store) continue;
              try {
                dbData[storeName] = await new Promise((resolve, reject) => {
                  try {
                    const tx = db.transaction(storeName, 'readonly');
                    const req = tx.objectStore(storeName).getAll();
                    req.addEventListener(
                      'success',
                      () => resolve((req.result as unknown[]).slice(0, opts.maxRecords)),
                      { once: true },
                    );
                    req.addEventListener('error', () => reject(req.error), { once: true });
                  } catch (e) {
                    reject(e);
                  }
                });
              } catch {
                dbData[storeName] = ['__error reading store__'];
              }
            }

            db.close();
            output[dbInfo.name] = dbData;
          }

          return output;
        },
        { database, store, maxRecords },
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
              2,
            ),
          },
        ],
      };
    }
  }
}
