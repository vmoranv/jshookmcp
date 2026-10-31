import { logger } from '@utils/logger';
import { evaluateWithTimeout } from '@modules/collector/PageController';
import type { CodeCollector } from '@server/domains/shared/modules/collector';
import type { ToolArgs, ToolResponse } from '@server/types';
import { argString, argBool, argNumber } from '@server/domains/shared/parse-args';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';

const MAX_WEBPACK_MODULES = 100;

export async function runWebpackEnumerate(
  collector: CodeCollector,
  args: ToolArgs,
): Promise<ToolResponse> {
  const searchKeyword = argString(args, 'searchKeyword', '');
  const forceRequireAll = argBool(args, 'forceRequireAll', !!searchKeyword);
  const maxResults = Math.min(argNumber(args, 'maxResults', 20), MAX_WEBPACK_MODULES);

  return handleSafe(async () => {
    const page = await collector.getActivePage();
    const result = await evaluateWithTimeout(
      page,
      async (opts: { searchKeyword: string; forceRequireAll: boolean; maxResults: number }) => {
        const w = window as unknown as Record<string, unknown>;

        const chunkKeys = Object.keys(w).filter(
          (k) => k.startsWith('webpackChunk') || k.startsWith('webpackJsonp'),
        );
        const moduleIdSet = collectWebpackModuleIds(w, chunkKeys);
        const requireFn = locateWebpackRequire(w, chunkKeys);

        const allIds = Array.from(moduleIdSet);

        if (!opts.forceRequireAll || !requireFn) {
          return {
            total: allIds.length,
            requireFound: !!requireFn,
            chunkKeys,
            moduleIds: allIds.slice(0, 200),
            matches: [] as Array<{ id: string; preview: string }>,
          };
        }

        return {
          total: allIds.length,
          requireFound: true,
          chunkKeys,
          moduleIds: allIds.slice(0, 200),
          matches: searchWebpackExports(requireFn, allIds, opts),
        };

        /** Collect all known module IDs from chunk arrays + __webpack_modules__. */
        // eslint-disable-next-line unicorn/consistent-function-scoping -- injected into the page
        function collectWebpackModuleIds(
          scope: Record<string, unknown>,
          keys: string[],
        ): Set<string> {
          const ids = new Set<string>();
          for (const key of keys) {
            const arr = scope[key];
            if (!Array.isArray(arr)) continue;
            const arrWithM = arr as unknown as { m?: Record<string, unknown> };
            if (arrWithM.m && typeof arrWithM.m === 'object') {
              for (const id of Object.keys(arrWithM.m)) ids.add(id);
            }
            for (const chunk of arr as unknown[]) {
              if (Array.isArray(chunk) && chunk[1] && typeof chunk[1] === 'object') {
                for (const id of Object.keys(chunk[1] as Record<string, unknown>)) {
                  ids.add(id);
                }
              }
            }
          }
          // Fallback: __webpack_modules__
          if (typeof scope['__webpack_modules__'] === 'object' && scope['__webpack_modules__']) {
            for (const id of Object.keys(scope['__webpack_modules__'] as Record<string, unknown>)) {
              ids.add(id);
            }
          }
          return ids;
        }

        /** Locate __webpack_require__ directly or synthesize one from a chunk
         * array's .m module table. */
        // eslint-disable-next-line unicorn/consistent-function-scoping -- injected into the page
        function locateWebpackRequire(
          scope: Record<string, unknown>,
          keys: string[],
        ): ((id: string) => unknown) | null {
          if (typeof scope['__webpack_require__'] === 'function') {
            return scope['__webpack_require__'] as (id: string) => unknown;
          }
          for (const key of keys) {
            const arr = scope[key] as unknown as { m?: Record<string, unknown> };
            if (arr?.m && typeof arr.m === 'object') {
              const mods = arr.m;
              return (id: string) => {
                try {
                  const mod = mods[id];
                  return typeof mod === 'function' ? (mod as () => unknown)() : mod;
                } catch {
                  return undefined;
                }
              };
            }
          }
          return null;
        }

        /** Require every module and collect keyword matches with previews. */
        // eslint-disable-next-line unicorn/consistent-function-scoping -- injected into the page
        function searchWebpackExports(
          requireIt: (id: string) => unknown,
          ids: string[],
          o: { searchKeyword: string; maxResults: number },
        ): Array<{ id: string; preview: string }> {
          const matches: Array<{ id: string; preview: string }> = [];
          for (const id of ids) {
            if (matches.length >= o.maxResults) break;
            try {
              const mod = requireIt(id);
              if (mod === undefined || mod === null) continue;
              let str: string;
              try {
                str = JSON.stringify(mod);
              } catch {
                str = String(mod);
              }
              if (!o.searchKeyword || str.toLowerCase().includes(o.searchKeyword.toLowerCase())) {
                matches.push({ id, preview: str.slice(0, 600) });
              }
            } catch {
              // module threw on require
            }
          }
          return matches;
        }
      },
      { searchKeyword, forceRequireAll, maxResults },
    );

    logger.info(
      `webpack_enumerate: found ${result.total} modules, ${result.matches.length} matches`,
    );
    return result as Record<string, unknown>;
  });
}

export async function runSourceMapExtract(
  collector: CodeCollector,
  args: ToolArgs,
): Promise<ToolResponse> {
  const includeContent = argBool(args, 'includeContent', false);
  const filterPath = argString(args, 'filterPath', '');
  const maxFiles = argNumber(args, 'maxFiles', 50);

  return handleSafe(async () => {
    const page = await collector.getActivePage();
    const result = await evaluateWithTimeout(
      page,
      async (opts: { includeContent: boolean; filterPath: string; maxFiles: number }) => {
        const scriptUrls = Array.from(document.querySelectorAll('script[src]'))
          .map((s) => (s as HTMLScriptElement).src)
          .filter(Boolean);

        type SourceEntry = { path: string; scriptUrl: string; content?: string };
        const files: SourceEntry[] = [];

        type SourceMapJson = { sources?: string[]; sourcesContent?: (string | null | undefined)[] };

        const processMapData = (mapData: SourceMapJson, scriptUrl: string): void => {
          if (!mapData.sources) return;
          for (let i = 0; i < mapData.sources.length; i++) {
            if (files.length >= opts.maxFiles) break;
            const sourcePath = mapData.sources[i];
            if (!sourcePath) continue;
            if (opts.filterPath && !sourcePath.includes(opts.filterPath)) continue;
            const entry: SourceEntry = { path: sourcePath, scriptUrl };
            if (opts.includeContent && mapData.sourcesContent) {
              const c = mapData.sourcesContent[i];
              if (c) entry.content = c;
            }
            files.push(entry);
          }
        };

        for (const scriptUrl of scriptUrls) {
          if (files.length >= opts.maxFiles) break;
          try {
            const ac1 = new AbortController();
            const t1 = setTimeout(() => ac1.abort(), 10000);
            let text: string;
            try {
              const resp = await fetch(scriptUrl, { cache: 'force-cache', signal: ac1.signal });
              text = await resp.text();
            } finally {
              clearTimeout(t1);
            }
            const match = text.match(/\/\/# sourceMappingURL=([^\s]+)/);
            if (!match?.[1]) continue;

            let mapUrl = match[1].trim();
            if (mapUrl.startsWith('data:')) {
              // Inline source map (base64)
              const b64 = mapUrl.replace(/^data:application\/json;base64,/, '');
              try {
                const mapData = JSON.parse(atob(b64)) as SourceMapJson;
                processMapData(mapData, scriptUrl);
              } catch {
                // bad base64
              }
              continue;
            }

            // External .map file
            if (!mapUrl.startsWith('http')) {
              try {
                mapUrl = new URL(mapUrl, scriptUrl).href;
              } catch {
                continue;
              }
            }

            const ac2 = new AbortController();
            const t2 = setTimeout(() => ac2.abort(), 10000);
            let mapData: SourceMapJson;
            try {
              const mapResp = await fetch(mapUrl, { signal: ac2.signal });
              mapData = await mapResp.json();
            } finally {
              clearTimeout(t2);
            }
            processMapData(mapData, scriptUrl);
          } catch {
            // skip script
          }
        }

        return { total: files.length, files };
      },
      { includeContent, filterPath, maxFiles },
    );

    logger.info(`source_map_extract: recovered ${result.total} source files`);
    return result as Record<string, unknown>;
  });
}
