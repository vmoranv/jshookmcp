/**
 * JS Heap Search — CE-like search over browser JS heap snapshot strings.
 */

import { DetailedDataManager } from '../../../../utils/DetailedDataManager.js';
import { cdpLimit } from '../../../../utils/concurrency.js';
import { logger } from '../../../../utils/logger.js';

interface JSHeapSearchDeps {
  getActivePage: () => Promise<unknown>;
  getActiveDriver: () => 'chrome' | 'camoufox';
}

interface CDPSessionLike {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  on(event: string, listener: (params: unknown) => void): void;
  detach(): Promise<void>;
}

interface CDPPageLike {
  createCDPSession(): Promise<CDPSessionLike>;
}

interface HeapSnapshotChunk {
  chunk: string;
}

interface HeapSearchMatch {
  nodeId: number;
  nodeType: string;
  value: string;
  objectPath: string;
  nameHint?: string;
}

interface HeapSnapshotMeta {
  node_fields?: string[];
  node_types?: unknown[];
}

interface HeapSnapshotLike {
  strings?: string[];
  nodes?: number[];
  snapshot?: {
    meta?: HeapSnapshotMeta;
  };
}

const NODE_TYPE_NAMES = [
  'hidden',
  'array',
  'string',
  'object',
  'code',
  'closure',
  'regexp',
  'number',
  'native',
  'synthetic',
  'concatenated string',
  'sliced string',
  'symbol',
  'bigint',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCDPPageLike(value: unknown): value is CDPPageLike {
  return isRecord(value) && typeof value.createCDPSession === 'function';
}

function isHeapSnapshotChunk(value: unknown): value is HeapSnapshotChunk {
  return isRecord(value) && typeof value.chunk === 'string';
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function toNumberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((v): v is number => typeof v === 'number') : [];
}

export class JSHeapSearchHandlers {
  private detailedDataManager: DetailedDataManager;

  constructor(private deps: JSHeapSearchDeps) {
    this.detailedDataManager = DetailedDataManager.getInstance();
  }

  async handleJSHeapSearch(args: Record<string, unknown>) {
    const pattern = typeof args.pattern === 'string' ? args.pattern : '';
    const maxResults = typeof args.maxResults === 'number' ? args.maxResults : 50;
    const caseSensitive = typeof args.caseSensitive === 'boolean' ? args.caseSensitive : false;

    if (!pattern) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: false, error: 'pattern is required' }, null, 2),
        }],
      };
    }

    return cdpLimit(async () => {
      let cdpSession: CDPSessionLike | null = null;
      let ownedSession = false;

      try {
        const page = await this.deps.getActivePage();
        if (!isCDPPageLike(page)) {
          throw new Error('Active page does not support CDP session creation');
        }

        cdpSession = await page.createCDPSession();
        ownedSession = true;

        logger.info(`[js_heap_search] Taking heap snapshot for pattern: "${pattern}"`);

        await cdpSession.send('HeapProfiler.enable');

        let snapshotData = '';
        cdpSession.on('HeapProfiler.addHeapSnapshotChunk', (params: unknown) => {
          if (isHeapSnapshotChunk(params)) {
            snapshotData += params.chunk;
          }
        });

        await cdpSession.send('HeapProfiler.takeHeapSnapshot', {
          reportProgress: false,
          treatGlobalObjectsAsRoots: true,
          captureNumericValue: false,
        });

        await cdpSession.send('HeapProfiler.disable');

        logger.info(`[js_heap_search] Snapshot size: ${(snapshotData.length / 1024).toFixed(1)} KB`);

        const matches = this.searchSnapshot(snapshotData, pattern, maxResults, caseSensitive);
        const result = {
          success: true,
          pattern,
          caseSensitive,
          snapshotSizeKB: Math.round(snapshotData.length / 1024),
          matchCount: matches.length,
          truncated: matches.length >= maxResults,
          matches,
          tip: matches.length > 0
            ? 'Use page_evaluate to inspect the objects at the paths found. E.g., eval the objectPath as a JS expression.'
            : 'No matches found. The value may be encrypted, compressed, or stored in a non-string form.',
        };

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(this.detailedDataManager.smartHandle(result, 51200), null, 2),
          }],
        };
      } catch (error) {
        logger.error('[js_heap_search] Error:', error);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: error instanceof Error ? error.message : String(error),
              },
              null,
              2
            ),
          }],
        };
      } finally {
        if (ownedSession && cdpSession) {
          try {
            await cdpSession.detach();
          } catch {
            // ignore cleanup error
          }
        }
      }
    });
  }

  private searchSnapshot(
    snapshotData: string,
    pattern: string,
    maxResults: number,
    caseSensitive: boolean
  ): HeapSearchMatch[] {
    try {
      const parsed = JSON.parse(snapshotData) as unknown;
      if (!isRecord(parsed)) {
        return [];
      }

      const snapshot = parsed as HeapSnapshotLike;
      const strings = toStringArray(snapshot.strings);
      const nodes = toNumberArray(snapshot.nodes);
      const nodeFields = toStringArray(snapshot.snapshot?.meta?.node_fields);
      const nodeTypesRaw = snapshot.snapshot?.meta?.node_types;
      const nodeTypeTable = Array.isArray(nodeTypesRaw) && Array.isArray(nodeTypesRaw[0])
        ? nodeTypesRaw[0] as unknown[]
        : [];
      const nodeFieldCount = nodeFields.length;

      if (nodeFieldCount === 0 || strings.length === 0) {
        return [];
      }

      const typeIdx = nodeFields.indexOf('type');
      const nameIdx = nodeFields.indexOf('name');
      const idIdx = nodeFields.indexOf('id');
      if (typeIdx < 0 || nameIdx < 0) {
        return [];
      }

      const searchStr = caseSensitive ? pattern : pattern.toLowerCase();
      const matches: HeapSearchMatch[] = [];
      const nodeCount = Math.floor(nodes.length / nodeFieldCount);

      for (let i = 0; i < nodeCount && matches.length < maxResults; i++) {
        const base = i * nodeFieldCount;
        const typeOrdinal = nodes[base + typeIdx] ?? 0;
        const nameOrdinal = nodes[base + nameIdx];
        if (nameOrdinal === undefined || nameOrdinal >= strings.length) {
          continue;
        }

        const tableName = nodeTypeTable[typeOrdinal];
        const nodeTypeName =
          (typeof tableName === 'string' ? tableName : undefined) ??
          NODE_TYPE_NAMES[typeOrdinal] ??
          `type_${typeOrdinal}`;

        if (
          nodeTypeName !== 'string' &&
          nodeTypeName !== 'concatenated string' &&
          nodeTypeName !== 'sliced string'
        ) {
          continue;
        }

        const value = strings[nameOrdinal];
        if (typeof value !== 'string') {
          continue;
        }
        const haystack = caseSensitive ? value : value.toLowerCase();
        if (!haystack.includes(searchStr)) {
          continue;
        }

        const rawId = idIdx >= 0 ? nodes[base + idIdx] : undefined;
        const nodeId = rawId !== undefined ? rawId : i;

        matches.push({
          nodeId,
          nodeType: nodeTypeName,
          value: value.length > 200 ? `${value.slice(0, 200)}…` : value,
          objectPath: `[HeapNode #${nodeId}]`,
          nameHint: value.slice(0, 80),
        });
      }

      return matches;
    } catch (error) {
      logger.warn('[js_heap_search] Snapshot parse error:', error);
      return [];
    }
  }
}
