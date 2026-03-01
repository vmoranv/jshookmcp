import { logger } from '../../../utils/logger.js';
import type { CodeCollector } from '../../../modules/collector/CodeCollector.js';
import type { ToolArgs, ToolResponse } from '../../types.js';
import { asJsonResponse, asErrorResponse } from '../shared/response.js';

export async function runWebpackEnumerate(
  collector: CodeCollector,
  args: ToolArgs
): Promise<ToolResponse> {
  const searchKeyword = (args.searchKeyword as string | undefined) ?? '';
  const forceRequireAll = (args.forceRequireAll as boolean | undefined) ?? !!searchKeyword;
  const maxResults = (args.maxResults as number | undefined) ?? 20;

  try {
    const page = await collector.getActivePage();
    const result = await page.evaluate(
      async (opts: { searchKeyword: string; forceRequireAll: boolean; maxResults: number }) => {
        const w = window as unknown as Record<string, unknown>;

        // Locate __webpack_require__
        let requireFn: ((id: string) => unknown) | null = null;
        if (typeof w['__webpack_require__'] === 'function') {
          requireFn = w['__webpack_require__'] as (id: string) => unknown;
        }

        // Collect all known module IDs from webpackChunk* / webpackJsonp* arrays
        const chunkKeys = Object.keys(w).filter(
          (k) => k.startsWith('webpackChunk') || k.startsWith('webpackJsonp')
        );

        const moduleIdSet = new Set<string>();

        for (const key of chunkKeys) {
          const arr = w[key];
          if (!Array.isArray(arr)) continue;
          const arrWithM = arr as unknown as { m?: Record<string, unknown> };
          if (arrWithM.m && typeof arrWithM.m === 'object') {
            for (const id of Object.keys(arrWithM.m)) moduleIdSet.add(id);
          }
          for (const chunk of arr as unknown[]) {
            if (Array.isArray(chunk) && chunk[1] && typeof chunk[1] === 'object') {
              for (const id of Object.keys(chunk[1] as Record<string, unknown>)) {
                moduleIdSet.add(id);
              }
            }
          }
        }

        // Fallback: __webpack_modules__
        if (typeof w['__webpack_modules__'] === 'object' && w['__webpack_modules__']) {
          for (const id of Object.keys(w['__webpack_modules__'] as Record<string, unknown>)) {
            moduleIdSet.add(id);
          }
        }

        // Try to find require via .m property on chunk arrays
        if (!requireFn) {
          for (const key of chunkKeys) {
            const arr = w[key] as unknown as { m?: Record<string, unknown> };
            if (arr && arr.m && typeof arr.m === 'object') {
              const mods = arr.m;
              requireFn = (id: string) => {
                try {
                  const fn = mods[id];
                  return typeof fn === 'function' ? (fn as () => unknown)() : fn;
                } catch {
                  return undefined;
                }
              };
              break;
            }
          }
        }

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

        // Search exports
        const fn = requireFn;
        const matches: Array<{ id: string; preview: string }> = [];
        for (const id of allIds) {
          if (matches.length >= opts.maxResults) break;
          try {
            const mod = fn(id);
            if (mod === undefined || mod === null) continue;
            let str: string;
            try {
              str = JSON.stringify(mod);
            } catch {
              str = String(mod);
            }
            if (!opts.searchKeyword || str.toLowerCase().includes(opts.searchKeyword.toLowerCase())) {
              matches.push({ id, preview: str.slice(0, 600) });
            }
          } catch {
            // module threw on require
          }
        }

        return {
          total: allIds.length,
          requireFound: true,
          chunkKeys,
          moduleIds: allIds.slice(0, 200),
          matches,
        };
      },
      { searchKeyword, forceRequireAll, maxResults }
    );

    logger.info(`webpack_enumerate: found ${result.total} modules, ${result.matches.length} matches`);
    return asJsonResponse(result);
  } catch (error) {
    return asErrorResponse(error);
  }
}

export async function runSourceMapExtract(
  collector: CodeCollector,
  args: ToolArgs
): Promise<ToolResponse> {
  const includeContent = (args.includeContent as boolean | undefined) ?? false;
  const filterPath = (args.filterPath as string | undefined) ?? '';
  const maxFiles = (args.maxFiles as number | undefined) ?? 50;

  try {
    const page = await collector.getActivePage();
    const result = await page.evaluate(
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
            const resp = await fetch(scriptUrl, { cache: 'force-cache' });
            const text = await resp.text();
            const match = text.match(/\/\/# sourceMappingURL=([^\s]+)/);
            if (!match || !match[1]) continue;

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

            const mapResp = await fetch(mapUrl);
            const mapData = (await mapResp.json()) as SourceMapJson;
            processMapData(mapData, scriptUrl);
          } catch {
            // skip script
          }
        }

        return { total: files.length, files };
      },
      { includeContent, filterPath, maxFiles }
    );

    logger.info(`source_map_extract: recovered ${result.total} source files`);
    return asJsonResponse(result);
  } catch (error) {
    return asErrorResponse(error);
  }
}
