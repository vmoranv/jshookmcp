import { logger } from '../../../utils/logger.js';
import type { ToolArgs, ToolResponse } from '../../types.js';
import { asJsonResponse, asTextResponse, asErrorResponse } from '../shared/response.js';
import type { CodeCollector } from '../../../modules/collector/CodeCollector.js';
import { runSourceMapExtract, runWebpackEnumerate } from '../analysis/handlers.web-tools.js';

interface CTFToolHandlerDeps {
  collector: CodeCollector;
}

export class CTFToolHandlers {
  private readonly collector: CodeCollector;

  constructor(deps: CTFToolHandlerDeps) {
    this.collector = deps.collector;
  }

  async handleWebpackEnumerate(args: ToolArgs): Promise<ToolResponse> {
    return runWebpackEnumerate(this.collector, args);
  }

  async handleSourceMapExtract(args: ToolArgs): Promise<ToolResponse> {
    return runSourceMapExtract(this.collector, args);
  }

  async handleFrameworkStateExtract(args: ToolArgs): Promise<ToolResponse> {
    const framework = (args.framework as string | undefined) ?? 'auto';
    const selector = (args.selector as string | undefined) ?? '';
    const maxDepth = (args.maxDepth as number | undefined) ?? 5;

    try {
      const page = await this.collector.getActivePage();
      const result = await page.evaluate(
        (opts: { framework: string; selector: string; maxDepth: number }) => {
          type AnyObj = Record<string, unknown>;

          function safeSerialize(val: unknown, depth = 0): unknown {
            if (depth > 4) return '[deep]';
            if (val === null || val === undefined) return val;
            if (typeof val === 'function') return '[Function]';
            if (typeof val !== 'object') return val;
            if (Array.isArray(val)) {
              return (val as unknown[]).slice(0, 20).map((v) => safeSerialize(v, depth + 1));
            }
            try {
              const out: Record<string, unknown> = {};
              let count = 0;
              for (const k of Object.keys(val as object)) {
                if (count++ > 30) {
                  out['__truncated__'] = true;
                  break;
                }
                out[k] = safeSerialize((val as AnyObj)[k], depth + 1);
              }
              return out;
            } catch {
              return '[unserializable]';
            }
          }

          const getRootEl = (): Element => {
            if (opts.selector) {
              return document.querySelector(opts.selector) ?? document.body;
            }
            return (
              document.getElementById('root') ??
              document.getElementById('app') ??
              document.querySelector('[data-reactroot]') ??
              document.body
            );
          };

          const extractReact = (): unknown[] | null => {
            const rootEl = getRootEl();
            const rootObj = rootEl as unknown as AnyObj;
            const fiberKey = Object.keys(rootObj).find(
              (k) =>
                k.startsWith('__reactFiber') ||
                k.startsWith('__reactInternalInstance') ||
                k.startsWith('__reactFiberContainer')
            );
            if (!fiberKey) return null;

            const states: unknown[] = [];
            const visited = new WeakSet<object>();

            const visitFiber = (fiber: AnyObj | null, depth: number): void => {
              if (!fiber || depth > opts.maxDepth || visited.has(fiber)) return;
              visited.add(fiber);

              if (fiber['memoizedState']) {
                const stateList: unknown[] = [];
                let s = fiber['memoizedState'] as AnyObj | null;
                let guard = 0;
                while (s && guard++ < 20) {
                  const queue = s['queue'] as AnyObj | undefined;
                  const val =
                    s['memoizedState'] !== undefined
                      ? s['memoizedState']
                      : queue?.['lastRenderedState'];
                  if (val !== undefined) stateList.push(safeSerialize(val));
                  s = (s['next'] as AnyObj | null | undefined) ?? null;
                }
                if (stateList.length > 0) {
                  const fiberType = fiber['type'] as AnyObj | string | undefined;
                  const componentName =
                    typeof fiberType === 'object' && fiberType !== null
                      ? String(fiberType['name'] ?? 'anonymous')
                      : typeof fiberType === 'string'
                        ? fiberType
                        : 'anonymous';
                  states.push({ component: componentName, state: stateList });
                }
              }

              visitFiber((fiber['child'] as AnyObj | null | undefined) ?? null, depth + 1);
              visitFiber((fiber['sibling'] as AnyObj | null | undefined) ?? null, depth + 1);
            };

            visitFiber((rootObj[fiberKey] as AnyObj | null | undefined) ?? null, 0);
            return states;
          };

          const extractVue3 = (): unknown[] | null => {
            const rootEl = getRootEl();
            const rootObj = rootEl as unknown as AnyObj;
            const vueKey = Object.keys(rootObj).find(
              (k) => k === '__vueParentComponent' || k === '__vue_app__' || k.startsWith('__vue')
            );
            if (!vueKey) return null;

            const comp = rootObj[vueKey] as AnyObj | null;
            if (!comp) return null;

            const states: unknown[] = [];
            const visited = new WeakSet<object>();

            const visitComp = (c: AnyObj, depth: number): void => {
              if (!c || depth > opts.maxDepth || visited.has(c)) return;
              visited.add(c);

              const setupState = safeSerialize(c['setupState'] ?? c['ctx']);
              const data = safeSerialize(c['$data'] ?? c['data']);
              if (setupState || data) {
                const compType = c['type'] as AnyObj | undefined;
                states.push({
                  component: compType?.['__name'] ?? 'unknown',
                  setupState,
                  data,
                });
              }

              const subTree = c['subTree'] as AnyObj | undefined;
              const children = subTree?.['children'];
              if (Array.isArray(children)) {
                for (const child of children as AnyObj[]) {
                  if (child?.['component']) {
                    visitComp(child['component'] as AnyObj, depth + 1);
                  }
                }
              }
            };

            visitComp(comp, 0);
            return states;
          };

          const extractVue2 = (): unknown[] | null => {
            const rootEl = getRootEl();
            const rootObj = rootEl as unknown as AnyObj;
            const vueKey = Object.keys(rootObj).find((k) => k === '__vue__');
            if (!vueKey) return null;

            const vm = rootObj[vueKey] as AnyObj | null;
            if (!vm) return null;

            const states: unknown[] = [];
            const visited = new WeakSet<object>();

            const visitVm = (v: AnyObj, depth: number): void => {
              if (!v || depth > opts.maxDepth || visited.has(v)) return;
              visited.add(v);

              const options = v['$options'] as AnyObj | undefined;
              states.push({
                component: options?.['name'] ?? 'unknown',
                data: safeSerialize(v['$data']),
              });

              const children = v['$children'] as AnyObj[] | undefined;
              if (Array.isArray(children)) {
                for (const child of children) visitVm(child, depth + 1);
              }
            };

            visitVm(vm, 0);
            return states;
          };

          const rootEl = getRootEl();
          const rootObj = rootEl as unknown as AnyObj;
          const keys = Object.keys(rootObj);

          let detectedFramework = opts.framework;
          if (detectedFramework === 'auto') {
            if (keys.some((k) => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'))) {
              detectedFramework = 'react';
            } else if (keys.some((k) => k === '__vueParentComponent' || k === '__vue_app__')) {
              detectedFramework = 'vue3';
            } else if (keys.some((k) => k === '__vue__')) {
              detectedFramework = 'vue2';
            }
          }

          let states: unknown[] | null = null;
          if (detectedFramework === 'react' || detectedFramework === 'auto') {
            states = extractReact();
          }
          if (!states && (detectedFramework === 'vue3' || detectedFramework === 'auto')) {
            states = extractVue3();
          }
          if (!states && (detectedFramework === 'vue2' || detectedFramework === 'auto')) {
            states = extractVue2();
          }

          return {
            detected: detectedFramework,
            states: states ?? [],
            found: states !== null && states.length > 0,
          };
        },
        { framework, selector, maxDepth }
      );

      logger.info(`framework_state_extract: detected=${result.detected}, states=${result.states.length}`);
      return asJsonResponse(result);
    } catch (error) {
      return asErrorResponse(error);
    }
  }

  async handleIndexedDBDump(args: ToolArgs): Promise<ToolResponse> {
    const database = (args.database as string | undefined) ?? '';
    const store = (args.store as string | undefined) ?? '';
    const maxRecords = (args.maxRecords as number | undefined) ?? 100;

    try {
      const page = await this.collector.getActivePage();
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

          const getAllFromStore = (db: IDBDatabase, storeName: string, max: number): Promise<unknown[]> =>
            new Promise((resolve, reject) => {
              try {
                const tx = db.transaction(storeName, 'readonly');
                const req = tx.objectStore(storeName).getAll();
                req.onsuccess = () => resolve((req.result as unknown[]).slice(0, max));
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
                dbData[storeName] = await getAllFromStore(db, storeName, opts.maxRecords);
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

      logger.info(`indexeddb_dump: dumped databases`);
      return asJsonResponse(result);
    } catch (error) {
      return asErrorResponse(error);
    }
  }

  async handleElectronAttach(args: ToolArgs): Promise<ToolResponse> {
    const port = (args.port as number | undefined) ?? 9229;
    const wsEndpointArg = (args.wsEndpoint as string | undefined) ?? '';
    const evaluateExpr = (args.evaluate as string | undefined) ?? '';
    const pageUrl = (args.pageUrl as string | undefined) ?? '';

    try {
      type CdpTarget = {
        id: string;
        title: string;
        url: string;
        webSocketDebuggerUrl?: string;
        type: string;
      };

      // Step 1: enumerate pages via CDP HTTP JSON API
      const baseUrl = `http://127.0.0.1:${port}`;
      const listUrl = `${baseUrl}/json/list`;
      let targets: CdpTarget[];

      try {
        const resp = await fetch(listUrl);
        targets = (await resp.json()) as CdpTarget[];
      } catch {
        // try /json fallback
        const resp = await fetch(`${baseUrl}/json`);
        targets = (await resp.json()) as CdpTarget[];
      }

      const filtered = pageUrl ? targets.filter((t) => t.url.includes(pageUrl)) : targets;

      if (!evaluateExpr) {
        return asJsonResponse({
          total: targets.length,
          filtered: filtered.length,
          pages: filtered.map((t) => ({
            id: t.id,
            title: t.title,
            url: t.url,
            type: t.type,
            wsUrl: t.webSocketDebuggerUrl,
          })),
        });
      }

      // Step 2: evaluate JS in the matched page using puppeteer.connect
      const target = filtered[0];
      if (!target || !target.webSocketDebuggerUrl) {
        return asTextResponse(
          `No matching page found (pageUrl filter: "${pageUrl}"). Available targets:\n` +
            targets.map((t) => `  [${t.type}] ${t.title} — ${t.url}`).join('\n'),
          true
        );
      }

      // Use rebrowser-puppeteer-core to connect via CDP
      const { default: puppeteer } = await import('rebrowser-puppeteer-core');
      const browserWsEndpoint =
        wsEndpointArg ||
        target.webSocketDebuggerUrl.replace(/\/devtools\/page\/[^/]+$/, '').replace('/devtools/page', '/devtools/browser');
      const browser = await puppeteer.connect({
        browserWSEndpoint: browserWsEndpoint,
        defaultViewport: null,
      });

      let evalResult: unknown;
      try {
        const pages = await browser.pages();
        const matchedPage = pages.find((p) => p.url().includes(target.url)) ?? pages[0];
        if (!matchedPage) throw new Error('Could not get page from connected browser');
        evalResult = await matchedPage.evaluate(evaluateExpr);
      } finally {
        await browser.disconnect();
      }

      logger.info(`electron_attach: evaluated in ${target.title}`);
      return asJsonResponse({
        target: { title: target.title, url: target.url },
        result: evalResult,
      });
    } catch (error) {
      return asErrorResponse(error);
    }
  }
}
