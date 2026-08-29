import type { Tool } from '@modelcontextprotocol/server';
import type { ToolProfileId } from '@server/registry/contracts';

export interface SearchCatalogEntry {
  readonly tool: Tool;
  readonly domain: string;
  readonly profiles?: readonly ToolProfileId[];
  readonly sceneKeywords?: readonly string[];
}

export interface SearchCatalog {
  readonly entries: readonly SearchCatalogEntry[];
  readonly tools: readonly Tool[];
  readonly entryByName: ReadonlyMap<string, SearchCatalogEntry>;
  readonly toolByName: ReadonlyMap<string, Tool>;
  readonly domainByToolName: ReadonlyMap<string, string>;
  readonly sceneKeywordsByToolName: ReadonlyMap<string, readonly string[]>;
}

let catalog: SearchCatalog | null = null;
let loadPromise: Promise<SearchCatalog> | null = null;

export async function loadSearchCatalog(): Promise<SearchCatalog> {
  if (catalog) return catalog;
  if (loadPromise) return loadPromise;

  loadPromise = import('@server/registry/generated-tool-catalog').then(
    ({ GENERATED_TOOL_CATALOG }) => {
      const entries = GENERATED_TOOL_CATALOG as readonly SearchCatalogEntry[];
      const entryByName = new Map<string, SearchCatalogEntry>();
      const toolByName = new Map<string, Tool>();
      const domainByToolName = new Map<string, string>();
      const sceneKeywordsByToolName = new Map<string, readonly string[]>();
      for (const entry of entries) {
        entryByName.set(entry.tool.name, entry);
        toolByName.set(entry.tool.name, entry.tool);
        domainByToolName.set(entry.tool.name, entry.domain);
        if (entry.sceneKeywords?.length) {
          sceneKeywordsByToolName.set(entry.tool.name, entry.sceneKeywords);
        }
      }
      catalog = {
        entries,
        tools: entries.map((entry) => entry.tool),
        entryByName,
        toolByName,
        domainByToolName,
        sceneKeywordsByToolName,
      };
      return catalog;
    },
  );
  return loadPromise;
}

/** Synchronous access for routing after a search/describe/activation entry point loaded the catalog. */
export function getLoadedSearchCatalog(): SearchCatalog | null {
  return catalog;
}

export function resetSearchCatalogForTests(): void {
  catalog = null;
  loadPromise = null;
}
