import type { Tool } from '@modelcontextprotocol/server';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { DomainManifest, ToolRegistration } from '@server/registry/contracts';
import type { ToolArgs } from '@server/types';
import type { ObjectPropertyInfo } from '@modules/debugger/DebuggerManager.impl.core.class';
import { V8InspectorClient } from '@modules/v8-inspector/V8InspectorClient';
import { bindByDepKey } from '@server/registry/bind-helpers';
import { handleSafe, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import { argStringRequired } from '@server/domains/shared/parse-args';
import { v8InspectorTools } from '../definitions';
import { getSnapshotCache, handleHeapSnapshotCapture } from './heap-snapshot';
import {
  attachSessionAsPage,
  type CDPSessionLike,
  type TargetSessionResolver,
} from './cdp-session';
import { handleBytecodeExtract } from './bytecode-extract';
import { getSnapshot } from './heap-snapshot';
import {
  deleteAllPersistedSnapshots,
  deletePersistedSnapshot,
  listPersistedSnapshots,
  loadPersistedSnapshot,
} from './snapshot-persistence';
import { resolveArtifactPath } from '@utils/artifacts';
import { getToolRequestContext } from '@server/runtime/ToolRequestContext';
import { cdpLimit } from '@utils/concurrency';

export interface V8InspectorDomainDependencies {
  ctx: MCPServerContext;
  client: V8InspectorClient;
}

function createDebuggerObjectData(properties: ObjectPropertyInfo[]): Record<string, unknown> {
  return {
    kind: 'runtime-object',
    source: 'debugger-session',
    propertyCount: properties.length,
    properties,
  };
}

function requirePageController(
  ctx: MCPServerContext,
): NonNullable<MCPServerContext['pageController']> {
  const pageController = ctx.pageController;
  if (!pageController) {
    throw new Error('PageController not available');
  }
  return pageController;
}

function createV8InspectorClient(ctx: MCPServerContext): V8InspectorClient {
  return new V8InspectorClient(ctx.pageController ? createPageGetter(ctx) : undefined);
}

function createPageGetter(ctx: MCPServerContext): () => Promise<unknown> {
  const pageController = requirePageController(ctx);
  return async () => await pageController.getPage();
}

/**
 * Build a target-aware session resolver. When the browser domain's collector
 * has an attached CDP target (page/worker/service_worker set via
 * browser_attach_cdp_target), CDP-backed v8 tools resolve against THAT
 * session so heap/allocation/WASM/WeakRef state can be captured inside
 * workers, not only the page. Falls back to the page otherwise.
 */
function createTargetSessionResolver(ctx: MCPServerContext): TargetSessionResolver {
  const collector = ctx.collector;
  const resolver: TargetSessionResolver = {
    getPage: ctx.pageController ? createPageGetter(ctx) : undefined,
  };
  if (collector) {
    resolver.getAttachedTargetSession = () =>
      (collector.getAttachedTargetSession() ?? null) as CDPSessionLike | null;
    resolver.getAttachedTargetInfo = () => {
      const info = collector.getAttachedTargetInfo();
      return info
        ? { type: info.type ?? null, url: info.url ?? null, targetId: info.targetId ?? null }
        : null;
    };
  }
  return resolver;
}

export class V8InspectorHandlers {
  private readonly deps: V8InspectorDomainDependencies;
  private readonly currentSnapshotIds = new Map<string, string>();

  constructor(deps: V8InspectorDomainDependencies) {
    this.deps = deps;
  }

  private getCurrentSessionId(): string {
    const sessionId = getToolRequestContext()?.sessionId;
    return typeof sessionId === 'string' && sessionId.trim().length > 0
      ? sessionId.trim()
      : 'default';
  }

  dropSessionState(sessionId: string): void {
    this.currentSnapshotIds.delete(sessionId.trim() || 'default');
  }

  async handle(toolName: string, args: ToolArgs): Promise<unknown> {
    const dispatchTable: Record<string, (toolArgs: ToolArgs) => Promise<unknown>> = {
      v8_heap_snapshot_capture: (toolArgs) => this.v8_heap_snapshot_capture(toolArgs),
      v8_heap_snapshot_analyze: (toolArgs) => this.v8_heap_snapshot_analyze(toolArgs),
      v8_heap_diff: (toolArgs) => this.v8_heap_diff(toolArgs),
      v8_object_inspect: (toolArgs) => this.v8_object_inspect(toolArgs),
      v8_heap_stats: (toolArgs) => this.v8_heap_stats(toolArgs),
      v8_bytecode_extract: (toolArgs) => this.v8_bytecode_extract(toolArgs),
      v8_version_detect: (toolArgs) => this.v8_version_detect(toolArgs),
      v8_heap_find_leaks: (toolArgs) => this.v8_heap_find_leaks(toolArgs),
      v8_heap_retainers: (toolArgs) => this.v8_heap_retainers(toolArgs),
      v8_object_compare: (toolArgs) => this.v8_object_compare(toolArgs),
      v8_wasm_inspect: (toolArgs) => this.v8_wasm_inspect(toolArgs),
      v8_deopt_trace: (toolArgs) => this.v8_deopt_trace(toolArgs),
      v8_turbofan_inspect: (toolArgs) => this.v8_turbofan_inspect(toolArgs),
      v8_function_retained: (toolArgs) => this.v8_function_retained(toolArgs),
      v8_turbofan_graph: (toolArgs) => this.v8_turbofan_graph(toolArgs),
      v8_heap_sampling: (toolArgs) => this.v8_heap_sampling(toolArgs),
      v8_allocation_track: (toolArgs) => this.v8_allocation_track(toolArgs),
      v8_weakrefs_inspect: (toolArgs) => this.v8_weakrefs_inspect(toolArgs),
      v8_heap_snapshot_list: (toolArgs) => this.v8_heap_snapshot_list(toolArgs),
      v8_heap_snapshot_delete: (toolArgs) => this.v8_heap_snapshot_delete(toolArgs),
      v8_heap_snapshot_export: (toolArgs) => this.v8_heap_snapshot_export(toolArgs),
    };

    const handler = dispatchTable[toolName];
    if (!handler) {
      throw new Error(`Unknown v8-inspector tool: ${toolName}`);
    }
    return handler(args);
  }

  // ── Standard dispatch: heap snapshot capture ──
  async v8_deopt_trace(args: ToolArgs): Promise<unknown> {
    const { handleDeoptTrace } = await import('@server/domains/v8-inspector/handlers/deopt-trace');
    return cdpLimit(() => handleDeoptTrace(args, createTargetSessionResolver(this.deps.ctx)));
  }

  async v8_turbofan_inspect(args: ToolArgs): Promise<unknown> {
    const { handleTurbofanInspect } =
      await import('@server/domains/v8-inspector/handlers/turbofan-inspect');
    return handleTurbofanInspect(args, createTargetSessionResolver(this.deps.ctx));
  }

  async v8_turbofan_graph(args: ToolArgs): Promise<unknown> {
    const { handleTurbofanGraph } =
      await import('@server/domains/v8-inspector/handlers/turbofan-graph');
    return cdpLimit(() => handleTurbofanGraph(args));
  }

  async v8_heap_sampling(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      requirePageController(this.deps.ctx);
      const { handleHeapSampling } =
        await import('@server/domains/v8-inspector/handlers/heap-sampling');
      return cdpLimit(() => handleHeapSampling(args, createTargetSessionResolver(this.deps.ctx)));
    });
  }

  async v8_allocation_track(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      requirePageController(this.deps.ctx);
      const { handleAllocationTrack } =
        await import('@server/domains/v8-inspector/handlers/allocation-track');
      const { getHeapParsePool } =
        await import('@server/domains/v8-inspector/handlers/heap-parse-worker');
      // The tracking heap snapshot can be GB-scale; its JSON.parse + allocation
      // build/sort run in the worker pool, not on the event loop (b1-02).
      return cdpLimit(() =>
        handleAllocationTrack(args, createTargetSessionResolver(this.deps.ctx), getHeapParsePool()),
      );
    });
  }

  async v8_weakrefs_inspect(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      requirePageController(this.deps.ctx);
      const { handleWeakRefsInspect } =
        await import('@server/domains/v8-inspector/handlers/weakrefs-inspect');
      return handleWeakRefsInspect(args, createTargetSessionResolver(this.deps.ctx));
    });
  }

  async v8_function_retained(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const snapshotId = argStringRequired(args, 'snapshotId');
      const pattern = argStringRequired(args, 'pattern');
      const maxResults = typeof args.maxResults === 'number' ? args.maxResults : 50;
      // Schema (definitions.ts) advertises a minRetainedSize filter (default 0);
      // previously the handler ignored it, so the tool filtered nothing even
      // when the caller asked for "only objects ≥ N bytes". Pass it through to
      // getRetainedByFunctionName, which already accepts it as its 4th param.
      const minRetainedSize =
        typeof args.minRetainedSize === 'number' && args.minRetainedSize >= 0
          ? args.minRetainedSize
          : 0;
      const snapshot = getSnapshot(snapshotId);
      if (!snapshot) {
        throw new Error(`Snapshot ${snapshotId} not found`);
      }
      const { HeapSnapshotParser } = await import('@modules/v8-inspector/HeapSnapshotParser');
      const { DominatorTreeBuilder } = await import('@modules/v8-inspector/DominatorTreeBuilder');
      const parser = new HeapSnapshotParser();
      parser.feedChunk(snapshot.chunks);
      const builder = new DominatorTreeBuilder();
      const tree = builder.buildDominatorTree(parser.parseNodes(), parser.parseEdges());
      const objects = builder.getRetainedByFunctionName(pattern, tree, maxResults, minRetainedSize);
      return {
        snapshotId,
        pattern,
        objects,
        objectCount: objects.length,
      };
    });
  }

  // ── Heap snapshot handlers ──

  async v8_heap_snapshot_capture(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      requirePageController(this.deps.ctx);
      const getPage = createPageGetter(this.deps.ctx);

      const persist = typeof args.persist === 'boolean' ? args.persist : true;

      const result = await cdpLimit(() =>
        handleHeapSnapshotCapture(args, {
          getPage,
          getSnapshot: () => this.currentSnapshotIds.get(this.getCurrentSessionId()) ?? null,
          setSnapshot: (id: string | null) => {
            const sessionId = this.getCurrentSessionId();
            if (id) this.currentSnapshotIds.set(sessionId, id);
            else this.currentSnapshotIds.delete(sessionId);
          },
          client: this.deps.client,
          persist,
          resolver: createTargetSessionResolver(this.deps.ctx),
          getTargetUrl: persist
            ? async () => {
                try {
                  const page = await getPage();
                  return (page as { url?: () => string })?.url?.() ?? null;
                } catch {
                  return null;
                }
              }
            : undefined,
        }),
      );

      // handleHeapSnapshotCapture always returns {success:true,…} (graceful
      // degradation); reflect its success flag so handleSafe merge is honest.
      if (result.success && result.snapshotId) {
        void this.deps.ctx.eventBus.emit('v8:heap_captured', {
          snapshotId: result.snapshotId,
          sizeBytes: result.sizeBytes,
          timestamp: result.capturedAt,
        });
      }

      return result;
    });
  }

  async v8_heap_snapshot_list(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const includeExpired = typeof args.includeExpired === 'boolean' ? args.includeExpired : false;
      const ttlMinutes =
        typeof args.ttlMinutes === 'number' && args.ttlMinutes > 0 ? args.ttlMinutes : 0;
      const ttlMs = ttlMinutes > 0 ? ttlMinutes * 60_000 : 0;

      const memCache = getSnapshotCache();
      const persistedAll = await listPersistedSnapshots(ttlMs > 0 ? { ttlMs } : {});
      const persistedById = new Map(persistedAll.map((p) => [p.id, p]));

      interface ListedSnapshotEntry {
        id: string;
        capturedAt: string;
        sizeBytes: number;
        simulated?: boolean;
        targetUrl?: string | null;
        displayPath?: string;
        inMemory: boolean;
        persisted: boolean;
        expired: boolean;
      }

      const seen = new Set<string>();
      const snapshots: ListedSnapshotEntry[] = [];
      let totalBytes = 0;

      for (const [id, snap] of memCache) {
        seen.add(id);
        const persistedMeta = persistedById.get(id);
        const expired = persistedMeta?.expired ?? false;
        if (!includeExpired && expired) {
          continue;
        }
        const entry: ListedSnapshotEntry = {
          id,
          capturedAt: snap.capturedAt,
          sizeBytes: snap.sizeBytes,
          simulated: snap.simulated,
          inMemory: true,
          persisted: !!snap.persisted || persistedMeta !== undefined,
          expired,
          ...(snap.targetUrl !== null || persistedMeta?.targetUrl !== null
            ? { targetUrl: snap.targetUrl ?? persistedMeta?.targetUrl ?? null }
            : {}),
          ...(snap.persisted?.displayPath ? { displayPath: snap.persisted.displayPath } : {}),
        };
        snapshots.push(entry);
        totalBytes += snap.sizeBytes;
      }

      for (const p of persistedAll) {
        if (seen.has(p.id)) {
          continue;
        }
        if (!includeExpired && p.expired) {
          continue;
        }
        const entry: ListedSnapshotEntry = {
          id: p.id,
          capturedAt: p.capturedAt,
          sizeBytes: p.sizeBytes,
          simulated: p.simulated,
          inMemory: false,
          persisted: true,
          expired: p.expired,
          ...(p.targetUrl !== null ? { targetUrl: p.targetUrl } : {}),
        };
        snapshots.push(entry);
        totalBytes += p.sizeBytes;
      }

      snapshots.sort((a, b) =>
        a.capturedAt < b.capturedAt ? 1 : a.capturedAt > b.capturedAt ? -1 : 0,
      );

      const inMemoryCount = snapshots.filter((s) => s.inMemory).length;
      const persistedCount = snapshots.filter((s) => s.persisted).length;
      const expiredCount = persistedAll.filter((p) => p.expired && !seen.has(p.id)).length;

      return {
        snapshots,
        count: snapshots.length,
        totalBytes,
        expiredCount: includeExpired ? persistedAll.filter((p) => p.expired).length : expiredCount,
        inMemoryCount,
        persistedCount,
      };
    });
  }

  async v8_heap_snapshot_delete(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const deleteAll = typeof args.deleteAll === 'boolean' ? args.deleteAll : false;

      if (deleteAll) {
        const disk = await deleteAllPersistedSnapshots();
        // Also clear the in-memory cache so stale entries don't linger.
        const cache = getSnapshotCache();
        let cacheCount = 0;
        for (const [id, snap] of cache) {
          if (snap.persisted) {
            cache.delete(id);
            cacheCount += 1;
          }
        }
        return {
          deleteAll: true,
          deletedCount: disk.deletedCount,
          freedBytes: disk.freedBytes,
          cacheEntriesDropped: cacheCount,
        };
      }

      const snapshotId = argStringRequired(args, 'snapshotId');
      const disk = await deletePersistedSnapshot(snapshotId);
      const cache = getSnapshotCache();
      let cacheDropped = false;
      if (cache.has(snapshotId)) {
        cache.delete(snapshotId);
        cacheDropped = true;
      }

      return {
        snapshotId,
        deleted: disk.deleted,
        freedBytes: disk.freedBytes,
        cacheDropped,
      };
    });
  }

  async v8_heap_snapshot_export(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const snapshotId = argStringRequired(args, 'snapshotId');

      // Resolve snapshot data — in-memory first, then try disk.
      let chunks: string[];
      const inMem = getSnapshot(snapshotId);
      if (inMem) {
        chunks = inMem.chunks;
      } else {
        const loaded = await loadPersistedSnapshot(snapshotId);
        if (!loaded) {
          throw new Error(`Snapshot ${snapshotId} not found (in-memory or persisted)`);
        }
        chunks = loaded.chunks;
      }

      const { absolutePath, displayPath } = await resolveArtifactPath({
        category: 'heap-snapshots',
        toolName: 'v8_heap_snapshot_export',
        target: snapshotId,
        ext: 'heapsnapshot',
      });

      // Concatenate chunks into the full .heapsnapshot JSON and write atomically.
      const body = chunks.join('');
      const { writeFile } = await import('node:fs/promises');
      await writeFile(absolutePath, body, 'utf8');

      return {
        snapshotId,
        absolutePath,
        displayPath,
        sizeBytes: Buffer.byteLength(body, 'utf8'),
      };
    });
  }

  async v8_heap_snapshot_analyze(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const snapshotId = argStringRequired(args, 'snapshotId');
      const snapshot = getSnapshot(snapshotId);
      if (!snapshot) {
        throw new Error(`Snapshot ${snapshotId} not found`);
      }

      // Parse options
      const includeDominatorTree =
        typeof args.includeDominatorTree === 'boolean' ? args.includeDominatorTree : false;
      const dominatorTreeDepth = typeof args.depth === 'number' && args.depth > 0 ? args.depth : 3;
      const includeLeakDetection =
        typeof args.includeLeakDetection === 'boolean' ? args.includeLeakDetection : false;
      const minLeakSize =
        typeof args.minLeakSize === 'number' && args.minLeakSize > 0
          ? args.minLeakSize
          : 1024 * 1024;

      // Lazy-load parser
      const { HeapSnapshotParser } = await import('@modules/v8-inspector/HeapSnapshotParser');
      const parser = new HeapSnapshotParser();

      // Feed chunks to parser
      parser.feedChunk(snapshot.chunks);

      // Analyze heap with options
      const analysis = await parser.analyzeHeap(snapshotId, {
        includeDominatorTree,
        dominatorTreeDepth,
        includeLeakDetection,
        minLeakSize,
      });

      // Return top N entries (default 50)
      const topN = typeof args.topN === 'number' && args.topN > 0 ? args.topN : 50;

      const result: {
        snapshotId: string;
        summary: {
          chunkCount: number;
          sizeBytes: number;
          totalObjects: number;
          detachedDOMNodes: number;
        };
        classHistogram: Array<{
          className: string;
          count: number;
          shallowSize: number;
          retainedSize: number;
        }>;
        dominatorTree?: typeof analysis.dominatorTree;
        suspectedLeaks?: typeof analysis.suspectedLeaks;
        parseTimeMs: number;
      } = {
        snapshotId,
        summary: {
          chunkCount: snapshot.chunks.length,
          sizeBytes: snapshot.sizeBytes,
          totalObjects: analysis.statistics.totalObjects,
          detachedDOMNodes: analysis.statistics.detachedDOMNodes,
        },
        classHistogram: analysis.classHistogram.slice(0, topN),
        parseTimeMs: analysis.metadata.parseTimeMs,
      };

      if (analysis.dominatorTree) {
        result.dominatorTree = analysis.dominatorTree;
      }

      if (analysis.suspectedLeaks) {
        result.suspectedLeaks = analysis.suspectedLeaks;
      }

      return result;
    });
  }

  async v8_heap_diff(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const beforeSnapshotId =
        typeof args.beforeSnapshotId === 'string' ? args.beforeSnapshotId : undefined;
      const afterSnapshotId =
        typeof args.afterSnapshotId === 'string' ? args.afterSnapshotId : undefined;

      if (!beforeSnapshotId || !afterSnapshotId) {
        throw new Error('Both beforeSnapshotId and afterSnapshotId are required');
      }

      const beforeSnapshot = getSnapshot(beforeSnapshotId);
      if (!beforeSnapshot) {
        throw new Error(`Snapshot ${beforeSnapshotId} not found`);
      }

      const afterSnapshot = getSnapshot(afterSnapshotId);
      if (!afterSnapshot) {
        throw new Error(`Snapshot ${afterSnapshotId} not found`);
      }

      const topN = typeof args.topN === 'number' && args.topN > 0 ? args.topN : 50;

      // Lazy-load parser and run structural diff
      const { HeapSnapshotParser } = await import('@modules/v8-inspector/HeapSnapshotParser');
      const startTime = Date.now();

      const beforeParser = new HeapSnapshotParser();
      beforeParser.feedChunk(beforeSnapshot.chunks);

      const afterParser = new HeapSnapshotParser();
      afterParser.feedChunk(afterSnapshot.chunks);

      const diffResult = beforeParser.diff(afterParser);
      const parseTimeMs = Date.now() - startTime;

      // Sort by selfSize descending for topN slicing
      const addedSorted = [...diffResult.added].toSorted((a, b) => b.selfSize - a.selfSize);
      const removedSorted = [...diffResult.removed].toSorted((a, b) => b.selfSize - a.selfSize);

      return {
        beforeSnapshotId,
        afterSnapshotId,
        sizeDeltaBytes: afterSnapshot.sizeBytes - beforeSnapshot.sizeBytes,
        sizeDelta: diffResult.sizeDelta,
        addedCount: diffResult.added.length,
        removedCount: diffResult.removed.length,
        added: addedSorted.slice(0, topN).map((n) => ({
          id: n.id,
          name: n.name,
          selfSize: n.selfSize,
          type: n.type,
        })),
        removed: removedSorted.slice(0, topN).map((n) => ({
          id: n.id,
          name: n.name,
          selfSize: n.selfSize,
          type: n.type,
        })),
        parseTimeMs,
      };
    });
  }

  async v8_object_inspect(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const address = argStringRequired(args, 'address');
      let objectData = await this.inspectObjectViaDebugger(address);
      let clientError: string | undefined;

      if (!objectData) {
        try {
          objectData = (await this.deps.client.getObjectByObjectId(address)) ?? undefined;
        } catch (e) {
          // Record the error context instead of silently swallowing it (B4).
          // If the client also yields no data, we surface success:false below.
          clientError = e instanceof Error ? e.message : String(e);
        }
      }

      if (!objectData) {
        // Both debugger and client failed to resolve the address — reflect the
        // real outcome instead of masking it as success:true (B4).
        throw new Error(
          clientError
            ? `Could not inspect object ${address}: ${clientError}`
            : `Could not inspect object ${address}: no data from debugger or Runtime`,
        );
      }

      return { address, objectData };
    });
  }

  async v8_heap_stats(_args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      requirePageController(this.deps.ctx);

      let heapUsage:
        | { jsHeapSizeUsed: number; jsHeapSizeTotal: number; jsHeapSizeLimit: number }
        | undefined;
      const warnings: string[] = [];
      try {
        heapUsage = await this.deps.client.getHeapUsage();
      } catch (e) {
        // Record the context instead of silently swallowing (B4). The snapshot
        // count is still valid, so this is a partial success with a warning.
        warnings.push(`heapUsage unavailable: ${e instanceof Error ? e.message : String(e)}`);
      }

      return {
        snapshotCount: getSnapshotCache().size,
        ...(heapUsage ? { heapUsage } : {}),
        ...(warnings.length > 0 ? { warnings } : {}),
      };
    });
  }

  async v8_bytecode_extract(args: ToolArgs): Promise<unknown> {
    const getPage = this.deps.ctx.pageController ? createPageGetter(this.deps.ctx) : undefined;
    return handleBytecodeExtract(args, {
      getPage,
    });
  }

  async v8_version_detect(_args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      if (!this.deps.ctx.pageController) {
        throw new Error(
          'v8_version_detect: PageController not available. Call browser_launch or browser_attach first.',
        );
      }
      const { VersionDetector } = await import('@modules/v8-inspector/VersionDetector');
      const detector = new VersionDetector(createPageGetter(this.deps.ctx));
      const version = await detector.detectV8Version();
      const supportsNativesSyntax = await detector.supportsNativesSyntax();
      return { version, features: { nativesSyntax: supportsNativesSyntax } };
    });
  }

  async v8_heap_find_leaks(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const snapshotId = argStringRequired(args, 'snapshotId');
      const snapshot = getSnapshot(snapshotId);
      if (!snapshot) {
        throw new Error(`Snapshot ${snapshotId} not found`);
      }

      const minRetainedSize =
        typeof args.minRetainedSize === 'number' && args.minRetainedSize > 0
          ? args.minRetainedSize
          : 1024 * 1024;
      const maxResults =
        typeof args.maxResults === 'number' && args.maxResults > 0 ? args.maxResults : 20;

      // Lazy-load parser and builder
      const { HeapSnapshotParser } = await import('@modules/v8-inspector/HeapSnapshotParser');
      const { DominatorTreeBuilder } = await import('@modules/v8-inspector/DominatorTreeBuilder');

      const parser = new HeapSnapshotParser();
      parser.feedChunk(snapshot.chunks);

      const nodes = parser.parseNodes();
      const edges = parser.parseEdges();

      const builder = new DominatorTreeBuilder();
      const tree = builder.buildDominatorTree(nodes, edges);
      const allLeaks = builder.findLeakCandidates(tree, minRetainedSize);

      const leakCandidates = allLeaks.slice(0, maxResults).map((leak) => ({
        nodeId: leak.nodeId,
        name: leak.name,
        reason: leak.reason,
        confidence: leak.confidence,
        retainedSize: leak.retainedSize,
        shallowSize: leak.shallowSize,
        path: leak.path,
      }));

      return {
        snapshotId,
        leakCandidates,
        totalCandidates: allLeaks.length,
      };
    });
  }

  async v8_heap_retainers(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const snapshotId = argStringRequired(args, 'snapshotId');
      const snapshot = getSnapshot(snapshotId);
      if (!snapshot) {
        throw new Error(`Snapshot ${snapshotId} not found`);
      }

      const nodeIds = Array.isArray(args.nodeIds)
        ? (args.nodeIds.filter(
            (v) => typeof v === 'number' && Number.isFinite(v) && v > 0,
          ) as number[])
        : [];

      if (nodeIds.length === 0) {
        throw new Error('nodeIds must be a non-empty array of positive integers');
      }

      if (nodeIds.length > 100) {
        throw new Error('nodeIds must contain at most 100 entries');
      }

      const maxSteps =
        typeof args.maxSteps === 'number' && args.maxSteps > 0 && args.maxSteps <= 200
          ? args.maxSteps
          : 50;

      const { HeapSnapshotParser } = await import('@modules/v8-inspector/HeapSnapshotParser');
      const { DominatorTreeBuilder } = await import('@modules/v8-inspector/DominatorTreeBuilder');

      const parser = new HeapSnapshotParser();
      parser.feedChunk(snapshot.chunks);

      const nodes = parser.parseNodes();
      const edges = parser.parseEdges();

      const builder = new DominatorTreeBuilder();
      builder.buildDominatorTree(nodes, edges);

      const chains = builder.getRetainerChains(nodeIds, maxSteps);

      let totalSteps = 0;
      for (const chain of Object.values(chains)) {
        totalSteps += chain.length;
      }

      return {
        snapshotId,
        chains,
        chainCount: Object.keys(chains).length,
        totalTraced: totalSteps,
      };
    });
  }

  async v8_wasm_inspect(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const scriptId =
        typeof args.scriptId === 'string' && args.scriptId.length > 0 ? args.scriptId : undefined;
      const includeStructs = typeof args.includeStructs === 'boolean' ? args.includeStructs : true;

      if (!this.deps.ctx.pageController) {
        // Structured graceful-failure object — success:false survives the
        // handleSafe merge (Object.assign overwrites .ok()'s success:true).
        return {
          success: false,
          modules: [],
          totalModules: 0,
          wasmScripts: [],
          summary: {
            totalWasmModules: 0,
            gcModules: 0,
            nonGcModules: 0,
            hasGcFeature: false,
            hasThreadsFeature: false,
            hasSimdFeature: false,
          },
          wasmGcAvailable: false,
          error: 'PageController not available. Call browser_launch or browser_attach first.',
        };
      }

      const resolver = createTargetSessionResolver(this.deps.ctx);
      const attachedSession = resolver.getAttachedTargetSession?.() ?? null;
      let wasmPage: unknown;
      if (attachedSession) {
        // Attached CDP target (worker/SW via browser_attach_cdp_target) — run
        // WASM inspection against that target. The session is collector-owned;
        // attachSessionAsPage wraps it so inspectWasmGc's internal detach is
        // a no-op and the browser attach state survives.
        wasmPage = attachSessionAsPage(attachedSession);
      } else {
        const page = await resolver.getPage?.();
        if (!page) {
          throw new Error('No active page. Call browser_launch or browser_attach first.');
        }
        wasmPage = page;
      }

      const { inspectWasmGc } = await import('@modules/v8-inspector/WasmGcInspector');
      const result = await inspectWasmGc(wasmPage, { scriptId, includeStructs });

      return {
        success: result.success,
        modules: result.modules,
        totalModules: result.totalModules,
        wasmScripts: result.wasmScripts,
        summary: result.summary,
        wasmGcAvailable: result.wasmGcAvailable,
        ...(includeStructs && result.structs.length > 0 ? { structs: result.structs } : {}),
      };
    });
  }

  async v8_object_compare(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const objectIds: number[] | null = Array.isArray(args.objectIds)
        ? (args.objectIds.filter(
            (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0,
          ) as number[])
        : null;
      if (!objectIds || objectIds.length === 0) {
        throw new Error('objectIds must be a non-empty array of positive integers');
      }
      if (objectIds.length > 50) {
        throw new Error('objectIds must contain at most 50 entries');
      }

      const anotherSnapshotId: string | undefined =
        typeof args.anotherSnapshotId === 'string' && args.anotherSnapshotId.length > 0
          ? args.anotherSnapshotId
          : undefined;

      const anotherObjectIds: number[] | undefined = anotherSnapshotId
        ? Array.isArray(args.anotherObjectIds)
          ? (args.anotherObjectIds.filter(
              (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0,
            ) as number[])
          : undefined
        : undefined;

      if (anotherSnapshotId && !anotherObjectIds) {
        throw new Error('anotherObjectIds is required when anotherSnapshotId is provided');
      }
      if (anotherObjectIds && anotherObjectIds.length !== objectIds.length) {
        throw new Error(
          `anotherObjectIds must have the same length as objectIds (${objectIds.length}), got ${anotherObjectIds.length}`,
        );
      }

      const snapshotId = argStringRequired(args, 'snapshotId');
      const snapshot = getSnapshot(snapshotId);
      if (!snapshot) {
        throw new Error(`Snapshot ${snapshotId} not found`);
      }
      if (anotherSnapshotId && !getSnapshot(anotherSnapshotId)) {
        throw new Error(`Snapshot ${anotherSnapshotId} not found`);
      }

      const minDeltaBytes =
        typeof args.minDeltaBytes === 'number' && args.minDeltaBytes >= 0
          ? args.minDeltaBytes
          : 1024;

      const { HeapSnapshotParser } = await import('@modules/v8-inspector/HeapSnapshotParser');
      const { DominatorTreeBuilder } = await import('@modules/v8-inspector/DominatorTreeBuilder');
      type DominatorNode = import('@modules/v8-inspector/DominatorTreeBuilder').DominatorNode;

      // Parse primary
      const priParser = new HeapSnapshotParser();
      priParser.feedChunk(snapshot.chunks);
      const priNodes = priParser.parseNodes();
      const priEdges = priParser.parseEdges();

      // Node lookup
      type NodeEntry = { name: string; selfSize: number };
      const priMap = new Map<number, NodeEntry>();
      for (const n of priNodes) priMap.set(n.id, { name: n.name, selfSize: n.selfSize });

      // Retained sizes (fail-soft: fallback to selfSize when dominator tree fails)
      const priRetained = new Map<number, number>();
      try {
        const tree = new DominatorTreeBuilder().buildDominatorTree(priNodes, priEdges);
        (function walk(n: DominatorNode): void {
          priRetained.set(n.nodeId, n.retainedSize);
          for (const c of n.children) walk(c);
        })(tree);
      } catch {
        for (const n of priNodes) priRetained.set(n.id, n.selfSize);
      }

      // Property counts
      const priProps = new Map<number, number>();
      for (const e of priEdges) priProps.set(e.fromId, (priProps.get(e.fromId) ?? 0) + 1);

      // ── Secondary snapshot ──
      let secNodes: typeof priNodes | undefined;
      let secRetained: Map<number, number> | undefined;
      let secProps: Map<number, number> | undefined;
      let secMap: Map<number, NodeEntry> | undefined;

      if (anotherSnapshotId) {
        const snap = getSnapshot(anotherSnapshotId)!;
        const sp = new HeapSnapshotParser();
        sp.feedChunk(snap.chunks);
        secNodes = sp.parseNodes();
        const secEdges = sp.parseEdges();

        secRetained = new Map<number, number>();
        try {
          const tree = new DominatorTreeBuilder().buildDominatorTree(secNodes, secEdges);
          (function walk(n: DominatorNode): void {
            secRetained!.set(n.nodeId, n.retainedSize);
            for (const c of n.children) walk(c);
          })(tree);
        } catch {
          for (const n of secNodes) secRetained.set(n.id, n.selfSize);
        }

        secProps = new Map<number, number>();
        for (const e of secEdges) secProps.set(e.fromId, (secProps.get(e.fromId) ?? 0) + 1);

        secMap = new Map<number, NodeEntry>();
        for (const n of secNodes) secMap.set(n.id, { name: n.name, selfSize: n.selfSize });
      }

      // ── Resolve + compare ──
      interface SnapObject {
        nodeId: number;
        name: string;
        shallowSize: number;
        retainedSize: number;
        propertyCount: number;
      }
      const skipped: number[] = [];

      function resolve(
        id: number,
        map: Map<number, NodeEntry>,
        ret: Map<number, number>,
        prop: Map<number, number>,
      ): SnapObject | null {
        const e = map.get(id);
        if (!e) {
          skipped.push(id);
          return null;
        }
        return {
          nodeId: id,
          name: e.name,
          shallowSize: e.selfSize,
          retainedSize: ret.get(id) ?? e.selfSize,
          propertyCount: prop.get(id) ?? 0,
        };
      }

      interface Pair {
        objectA: SnapObject;
        objectB: SnapObject;
        delta: { shallowSize: number; retainedSize: number; propertyCount: number };
        sameClass: boolean;
        classMatch: boolean; // alias of sameClass (kept for response back-compat)
        interesting: boolean;
      }
      const pairs: Pair[] = [];

      if (anotherObjectIds && secNodes && secRetained && secProps && secMap) {
        for (let i = 0; i < objectIds.length; i++) {
          const a = resolve(objectIds[i]!, priMap, priRetained, priProps);
          const b = resolve(anotherObjectIds[i]!, secMap, secRetained, secProps);
          if (!a || !b) continue;
          const sc = a.name === b.name;
          pairs.push({
            objectA: a,
            objectB: b,
            delta: {
              shallowSize: b.shallowSize - a.shallowSize,
              retainedSize: b.retainedSize - a.retainedSize,
              propertyCount: b.propertyCount - a.propertyCount,
            },
            classMatch: sc,
            sameClass: sc,
            interesting:
              Math.abs(b.shallowSize - a.shallowSize) >= minDeltaBytes ||
              Math.abs(b.retainedSize - a.retainedSize) >= minDeltaBytes ||
              !sc,
          });
        }
      } else {
        const resolved: SnapObject[] = [];
        for (const id of objectIds) {
          const o = resolve(id, priMap, priRetained, priProps);
          if (o) resolved.push(o);
        }
        const includeSelf = resolved.length === 1;
        for (let i = 0; i < resolved.length; i++) {
          for (let j = includeSelf ? i : i + 1; j < resolved.length; j++) {
            const a = resolved[i]!,
              b = resolved[j]!;
            const sc = a.name === b.name;
            const dS = b.shallowSize - a.shallowSize,
              dR = b.retainedSize - a.retainedSize;
            pairs.push({
              objectA: a,
              objectB: b,
              delta: {
                shallowSize: dS,
                retainedSize: dR,
                propertyCount: b.propertyCount - a.propertyCount,
              },
              classMatch: sc,
              sameClass: sc,
              interesting: Math.abs(dS) >= minDeltaBytes || Math.abs(dR) >= minDeltaBytes || !sc,
            });
          }
        }
      }

      pairs.sort((a, b) => Math.abs(b.delta.retainedSize) - Math.abs(a.delta.retainedSize));

      return {
        snapshotId,
        ...(anotherSnapshotId ? { anotherSnapshotId } : {}),
        pairs,
        ...(skipped.length > 0 ? { skippedNodes: skipped } : {}),
        pairCount: pairs.length,
      };
    });
  }

  private async inspectObjectViaDebugger(
    address: string,
  ): Promise<Record<string, unknown> | undefined> {
    const debuggerManager = this.deps.ctx.debuggerManager;
    if (!debuggerManager || typeof debuggerManager.getObjectPropertiesById !== 'function') {
      return undefined;
    }

    try {
      const properties = await debuggerManager.getObjectPropertiesById(address);
      if (!Array.isArray(properties)) {
        return undefined;
      }
      return createDebuggerObjectData(properties);
    } catch {
      return undefined;
    }
  }
}

const registrations: ToolRegistration[] = v8InspectorTools.map((toolDef: Tool) => ({
  tool: toolDef,
  domain: 'v8-inspector',
  bind: bindByDepKey<V8InspectorHandlers>('v8InspectorHandlers', (handlers, args) =>
    handlers.handle(toolDef.name, args),
  ),
}));

async function ensure(ctx: MCPServerContext): Promise<V8InspectorHandlers> {
  const client = createV8InspectorClient(ctx);
  const handlers = new V8InspectorHandlers({ ctx, client });
  ctx.v8InspectorHandlers = handlers;
  return handlers;
}

const manifest: DomainManifest<'v8InspectorHandlers', V8InspectorHandlers, 'v8-inspector'> = {
  kind: 'domain-manifest',
  version: 1,
  domain: 'v8-inspector',
  depKey: 'v8InspectorHandlers',
  profiles: ['workflow', 'full'],
  registrations,
  ensure,
  prerequisites: {
    v8_heap_snapshot_capture: [
      {
        condition: 'Browser must be connected',
        fix: 'Call browser_launch or browser_attach first',
      },
    ],
    v8_heap_snapshot_analyze: [
      {
        condition: 'A snapshotId must be provided',
        fix: 'Capture a heap snapshot before analysis',
      },
    ],
    v8_heap_diff: [
      {
        condition: 'Both snapshot identifiers are required',
        fix: 'Capture before/after snapshots before diffing',
      },
    ],
  },
  toolDependencies: [
    {
      from: 'v8_heap_snapshot_capture',
      to: 'browser_attach',
      relation: 'requires',
      weight: 0.8,
    },
    {
      from: 'v8_object_inspect',
      to: 'v8_heap_snapshot_analyze',
      relation: 'precedes',
      weight: 0.6,
    },
  ],
  workflowRule: {
    patterns: [/v8.*heap/i, /heap.*snapshot/i, /jit/i, /object.*address/i],
    priority: 80,
    tools: [
      'v8_heap_snapshot_capture',
      'v8_heap_snapshot_analyze',
      'v8_object_inspect',
      'v8_heap_stats',
    ],
    hint: 'Capture a heap snapshot, analyze it, then inspect interesting objects by address.',
  },
};

export default manifest;
