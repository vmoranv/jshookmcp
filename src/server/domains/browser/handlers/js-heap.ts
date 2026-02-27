/**
 * JS Heap Search — CE (Cheat Engine) equivalent for browser JS runtime.
 *
 * Uses CDP HeapProfiler.takeHeapSnapshot to capture a snapshot, then searches
 * for string values matching a pattern, returning object paths for navigation.
 *
 * WARNING: Heap snapshots can be 100MB+ for complex pages.
 * Use maxResults to limit output, results go through DetailedDataManager.
 */

import { DetailedDataManager } from '../../../../utils/DetailedDataManager.js';
import { cdpLimit } from '../../../../utils/concurrency.js';
import { logger } from '../../../../utils/logger.js';

interface JSHeapSearchDeps {
  getActivePage: () => Promise<any>;
  getActiveDriver: () => 'chrome' | 'camoufox';
}

interface HeapSearchMatch {
  nodeId: number;
  nodeType: string;
  value: string;
  objectPath: string;
  nameHint?: string;
}

const NODE_TYPE_NAMES = ['hidden', 'array', 'string', 'object', 'code', 'closure', 'regexp', 'number', 'native', 'synthetic', 'concatenated string', 'sliced string', 'symbol', 'bigint'];

export class JSHeapSearchHandlers {
  private detailedDataManager: DetailedDataManager;

  constructor(private deps: JSHeapSearchDeps) {
    this.detailedDataManager = DetailedDataManager.getInstance();
  }

  async handleJSHeapSearch(args: Record<string, unknown>) {
    const pattern = args.pattern as string;
    const maxResults = (args.maxResults as number) ?? 50;
    const caseSensitive = (args.caseSensitive as boolean) ?? false;

    if (!pattern) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: false, error: 'pattern is required' }, null, 2),
        }],
      };
    }

    return cdpLimit(async () => {
      let cdpSession: any = null;
      let ownedSession = false;

      try {
      const page = await this.deps.getActivePage();
      cdpSession = await page.createCDPSession();
      ownedSession = true;

      logger.info(`[js_heap_search] Taking heap snapshot for pattern: "${pattern}"`);

      await cdpSession.send('HeapProfiler.enable');

      let snapshotData = '';
      cdpSession.on('HeapProfiler.addHeapSnapshotChunk', (params: { chunk: string }) => {
        snapshotData += params.chunk;
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
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }, null, 2),
        }],
      };
    } finally {
      if (ownedSession && cdpSession) {
        try { await cdpSession.detach(); } catch { /* ignore */ }
      }
    }
    });
  }

  private searchSnapshot(snapshotData: string, pattern: string, maxResults: number, caseSensitive: boolean): HeapSearchMatch[] {
    try {
      const snapshot = JSON.parse(snapshotData);
      const strings: string[] = snapshot.strings ?? [];
      const nodes: number[] = snapshot.nodes ?? [];
      const nodeFields: string[] = snapshot.snapshot?.meta?.node_fields ?? [];
      const nodeTypes: string[][] = snapshot.snapshot?.meta?.node_types ?? [];
      const nodeFieldCount = nodeFields.length;

      if (nodeFieldCount === 0 || strings.length === 0) {
        return [];
      }

      // Find field indices
      const typeIdx = nodeFields.indexOf('type');
      const nameIdx = nodeFields.indexOf('name');
      const idIdx = nodeFields.indexOf('id');

      if (typeIdx < 0 || nameIdx < 0) return [];

      const searchStr = caseSensitive ? pattern : pattern.toLowerCase();
      const matches: HeapSearchMatch[] = [];

      const nodeCount = Math.floor(nodes.length / nodeFieldCount);

      for (let i = 0; i < nodeCount && matches.length < maxResults; i++) {
        const base = i * nodeFieldCount;
        const typeOrdinal = nodes[base + typeIdx] ?? 0;
        const nameOrdinal = nodes[base + nameIdx];

        if (nameOrdinal === undefined || nameOrdinal >= strings.length) continue;

        const nodeTypeName = (nodeTypes[0] as any)?.[typeOrdinal] ?? NODE_TYPE_NAMES[typeOrdinal] ?? `type_${typeOrdinal}`;

        // Only search string nodes and object name strings
        if (nodeTypeName !== 'string' && nodeTypeName !== 'concatenated string' && nodeTypeName !== 'sliced string') continue;

        const value = strings[nameOrdinal];
        if (!value || typeof value !== 'string') continue;

        const haystack = caseSensitive ? value : value.toLowerCase();
        if (!haystack.includes(searchStr)) continue;

        const rawId = idIdx >= 0 ? nodes[base + idIdx] : undefined;
        const nodeId: number = rawId !== undefined ? rawId : i;

        matches.push({
          nodeId,
          nodeType: nodeTypeName,
          value: value.length > 200 ? value.slice(0, 200) + '…' : value,
          objectPath: `[HeapNode #${nodeId}]`,
          nameHint: value.slice(0, 80),
        });
      }

      return matches;
    } catch (err) {
      logger.warn('[js_heap_search] Snapshot parse error:', err);
      return [];
    }
  }
}
