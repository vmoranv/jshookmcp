import { DetailedDataManager } from '@utils/DetailedDataManager';
import { cdpLimit } from '@utils/concurrency';
import { logger } from '@utils/logger';
import { argString, argNumber, argBool } from '@server/domains/shared/parse-args';
import { R } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/domains/shared/ResponseBuilder';

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

export class JSHeapSearchHandlers {
  private detailedDataManager: DetailedDataManager;

  constructor(private deps: JSHeapSearchDeps) {
    this.detailedDataManager = DetailedDataManager.getInstance();
  }

  async handleJSHeapSearch(args: Record<string, unknown>): Promise<ToolResponse> {
    const pattern = argString(args, 'pattern', '');
    const maxResults = argNumber(args, 'maxResults', 50);
    const caseSensitive = argBool(args, 'caseSensitive', false);

    if (!pattern) {
      return R.fail('pattern is required').build();
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

        logger.info('[js_heap_search] Taking heap snapshot', {
          patternLength: pattern.length,
          caseSensitive,
          maxResults,
        });

        await cdpSession.send('HeapProfiler.enable');

        const snapshotChunks: string[] = [];
        let snapshotSize = 0;
        cdpSession.on('HeapProfiler.addHeapSnapshotChunk', (params: unknown) => {
          if (isHeapSnapshotChunk(params)) {
            snapshotChunks.push(params.chunk);
            snapshotSize += params.chunk.length;
          }
        });

        await cdpSession.send('HeapProfiler.takeHeapSnapshot', {
          reportProgress: false,
          treatGlobalObjectsAsRoots: true,
          captureNumericValue: false,
        });

        await cdpSession.send('HeapProfiler.disable');

        logger.info(`[js_heap_search] Snapshot size: ${(snapshotSize / 1024).toFixed(1)} KB`);

        const snapshotData = snapshotChunks.join('');
        snapshotChunks.length = 0;
        const matches = this.searchSnapshot(snapshotData, pattern, maxResults, caseSensitive);
        const result = {
          success: true,
          pattern,
          caseSensitive,
          snapshotSizeKB: Math.round(snapshotSize / 1024),
          matchCount: matches.length,
          truncated: matches.length >= maxResults,
          matches,
          tip:
            matches.length > 0
              ? 'Use page_evaluate to inspect the objects at the paths found. E.g., eval the objectPath as a JS expression.'
              : 'No matches found. The value may be encrypted, compressed, or stored in a non-string form.',
        };

        return R.ok().build(this.detailedDataManager.smartHandle(result, 51200) as any);
      } catch (error) {
        logger.error('[js_heap_search] Error:', error);
        return R.fail(error).build();
      } finally {
        if (ownedSession && cdpSession) {
          try {
            await cdpSession.detach();
          } catch {
            // Snapshot already returned — detach failure is harmless
          }
        }
      }
    });
  }

  private searchSnapshot(
    snapshotData: string,
    pattern: string,
    maxResults: number,
    caseSensitive: boolean,
  ): HeapSearchMatch[] {
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(snapshotData);
      } catch {
        return [];
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return [];
      }

      const snapshot = parsed as Record<string, unknown>;
      const stringsRaw = snapshot.strings;
      const nodesRaw = snapshot.nodes;
      const snapshotMeta =
        typeof snapshot.snapshot === 'object' && snapshot.snapshot !== null
          ? (snapshot.snapshot as Record<string, unknown>)
          : null;
      const meta =
        snapshotMeta && typeof snapshotMeta.meta === 'object' && snapshotMeta.meta !== null
          ? (snapshotMeta.meta as Record<string, unknown>)
          : null;
      const nodeFieldsRaw = meta?.node_fields;
      const nodeTypesRaw = meta?.node_types;

      if (!Array.isArray(nodeFieldsRaw) || !Array.isArray(stringsRaw) || !Array.isArray(nodesRaw)) {
        return [];
      }

      const nodeFieldCount = nodeFieldsRaw.length;
      if (nodeFieldCount === 0) return [];

      const typeIdx = nodeFieldsRaw.indexOf('type');
      const nameIdx = nodeFieldsRaw.indexOf('name');
      const idIdx = nodeFieldsRaw.indexOf('id');
      if (typeIdx < 0 || nameIdx < 0) return [];

      const nodeTypeTable =
        Array.isArray(nodeTypesRaw) && Array.isArray(nodeTypesRaw[0])
          ? (nodeTypesRaw[0] as unknown[])
          : [];

      const searchStr = caseSensitive ? pattern : pattern.toLowerCase();
      const matches: HeapSearchMatch[] = [];
      const nodeCount = Math.floor(nodesRaw.length / nodeFieldCount);
      const stringsArr = stringsRaw as string[];

      for (let i = 0; i < nodeCount && matches.length < maxResults; i++) {
        const base = i * nodeFieldCount;
        const typeOrdinal = nodesRaw[base + typeIdx] as number;
        const nameOrdinal = nodesRaw[base + nameIdx] as number;
        if (
          typeof nameOrdinal !== 'number' ||
          nameOrdinal < 0 ||
          nameOrdinal >= stringsArr.length
        ) {
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

        const value = stringsArr[nameOrdinal];
        if (typeof value !== 'string') {
          continue;
        }
        const haystack = caseSensitive ? value : value.toLowerCase();
        if (!haystack.includes(searchStr)) {
          continue;
        }

        const rawId = idIdx >= 0 ? (nodesRaw[base + idIdx] as number) : undefined;
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
