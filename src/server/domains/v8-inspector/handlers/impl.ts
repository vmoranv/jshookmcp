import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { DomainManifest, ToolRegistration } from '@server/registry/contracts';
import type { ToolArgs } from '@server/types';
import type { ObjectPropertyInfo } from '@modules/debugger/DebuggerManager.impl.core.class';
import { V8InspectorClient } from '@modules/v8-inspector/V8InspectorClient';
import { bindByDepKey } from '@server/registry/bind-helpers';
import { v8InspectorTools } from '../definitions';
import { getSnapshotCache, handleHeapSnapshotCapture } from './heap-snapshot';
import { handleBytecodeExtract } from './bytecode-extract';
import { handleJitInspect } from './jit-inspect';
import { getSnapshot } from './heap-snapshot';

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

function requireStringArg(args: ToolArgs, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${key} is required`);
  }
  return value;
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

function missingPageControllerResult(tool: string): {
  success: false;
  error: string;
  capability: string;
  fix: string;
} {
  return {
    success: false,
    error: `${tool}: PageController not available`,
    capability: 'page-controller',
    fix: 'Call browser_launch or browser_attach first, and select a tab that exposes a stable Page handle.',
  };
}

function createV8InspectorClient(ctx: MCPServerContext): V8InspectorClient {
  return new V8InspectorClient(ctx.pageController ? createPageGetter(ctx) : undefined);
}

function createPageGetter(ctx: MCPServerContext): () => Promise<unknown> {
  const pageController = requirePageController(ctx);
  return async () => await pageController.getPage();
}

export class V8InspectorHandlers {
  private currentSnapshotId: string | null = null;

  constructor(private readonly deps: V8InspectorDomainDependencies) {}

  async handle(toolName: string, args: ToolArgs): Promise<unknown> {
    const dispatchTable: Record<string, (toolArgs: ToolArgs) => Promise<unknown>> = {
      v8_heap_snapshot_capture: (toolArgs) => this.v8_heap_snapshot_capture(toolArgs),
      v8_heap_snapshot_analyze: (toolArgs) => this.v8_heap_snapshot_analyze(toolArgs),
      v8_heap_diff: (toolArgs) => this.v8_heap_diff(toolArgs),
      v8_object_inspect: (toolArgs) => this.v8_object_inspect(toolArgs),
      v8_heap_stats: (toolArgs) => this.v8_heap_stats(toolArgs),
      v8_bytecode_extract: (toolArgs) => this.v8_bytecode_extract(toolArgs),
      v8_version_detect: (toolArgs) => this.v8_version_detect(toolArgs),
      v8_jit_inspect: (toolArgs) => this.v8_jit_inspect(toolArgs),
      v8_heap_find_leaks: (toolArgs) => this.v8_heap_find_leaks(toolArgs),
      v8_heap_retainers: (toolArgs) => this.v8_heap_retainers(toolArgs),
      v8_object_compare: (toolArgs) => this.v8_object_compare(toolArgs),
      v8_wasm_inspect: (toolArgs) => this.v8_wasm_inspect(toolArgs),
      v8_deopt_trace: (toolArgs) => this.v8_deopt_trace(toolArgs),
      v8_turbofan_inspect: (toolArgs) => this.v8_turbofan_inspect(toolArgs),
      v8_function_retained: (toolArgs) => this.v8_function_retained(toolArgs),
      v8_turbofan_graph: (toolArgs) => this.v8_turbofan_graph(toolArgs),
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
    return handleDeoptTrace(args);
  }

  async v8_turbofan_inspect(args: ToolArgs): Promise<unknown> {
    const { handleTurbofanInspect } =
      await import('@server/domains/v8-inspector/handlers/turbofan-inspect');
    return handleTurbofanInspect(args, createPageGetter(this.deps.ctx));
  }

  async v8_turbofan_graph(args: ToolArgs): Promise<unknown> {
    const { handleTurbofanGraph } =
      await import('@server/domains/v8-inspector/handlers/turbofan-graph');
    return handleTurbofanGraph(args);
  }

  async v8_function_retained(args: ToolArgs) {
    const snapshotId = requireStringArg(args, 'snapshotId');
    const pattern = requireStringArg(args, 'pattern');
    const maxResults = typeof args.maxResults === 'number' ? args.maxResults : 50;
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
    const objects = builder.getRetainedByFunctionName(pattern, tree, maxResults);
    return {
      success: true,
      snapshotId,
      pattern,
      objects,
      objectCount: objects.length,
    };
  }

  // ── Heap snapshot handlers ──

  async v8_heap_snapshot_capture(args: ToolArgs): Promise<{
    success: boolean;
    snapshotId: string;
    capturedAt: string;
    sizeBytes: number;
    chunks: string[];
    simulated: boolean;
  }> {
    requirePageController(this.deps.ctx);
    const getPage = createPageGetter(this.deps.ctx);

    const result = await handleHeapSnapshotCapture(args, {
      getPage,
      getSnapshot: () => this.currentSnapshotId,
      setSnapshot: (id: string | null) => {
        this.currentSnapshotId = id;
      },
      client: this.deps.client,
    });

    if (result.success && result.snapshotId) {
      void this.deps.ctx.eventBus.emit('v8:heap_captured', {
        snapshotId: result.snapshotId,
        sizeBytes: result.sizeBytes,
        timestamp: result.capturedAt,
      });
    }

    return result;
  }

  async v8_heap_snapshot_analyze(args: ToolArgs): Promise<{
    success: boolean;
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
    dominatorTree?: {
      nodeId: number;
      name: string;
      retainedSize: number;
      shallowSize: number;
      children: unknown[];
    };
    suspectedLeaks?: Array<{
      nodeId: number;
      name: string;
      reason: string;
      confidence: number;
      retainedSize: number;
      shallowSize: number;
      path: string[];
    }>;
    parseTimeMs: number;
  }> {
    const snapshotId = requireStringArg(args, 'snapshotId');
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
      typeof args.minLeakSize === 'number' && args.minLeakSize > 0 ? args.minLeakSize : 1024 * 1024;

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
      success: boolean;
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
      success: true,
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
  }

  async v8_heap_diff(args: ToolArgs): Promise<{
    success: boolean;
    beforeSnapshotId: string;
    afterSnapshotId: string;
    sizeDeltaBytes: number;
    sizeDelta: number;
    addedCount: number;
    removedCount: number;
    added: Array<{ id: number; name: string; selfSize: number; type: string }>;
    removed: Array<{ id: number; name: string; selfSize: number; type: string }>;
    parseTimeMs: number;
  }> {
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
      success: true,
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
  }

  async v8_object_inspect(
    args: ToolArgs,
  ): Promise<{ success: boolean; address: string; objectData?: Record<string, unknown> }> {
    const address = requireStringArg(args, 'address');
    let objectData = await this.inspectObjectViaDebugger(address);

    if (!objectData) {
      try {
        objectData = (await this.deps.client.getObjectByObjectId(address)) ?? undefined;
      } catch {
        // objectData remains undefined — graceful degradation
      }
    }

    return { success: true, address, ...(objectData ? { objectData } : {}) };
  }

  async v8_heap_stats(_args: ToolArgs): Promise<{
    success: boolean;
    snapshotCount: number;
    heapUsage?: { jsHeapSizeUsed: number; jsHeapSizeTotal: number; jsHeapSizeLimit: number };
  }> {
    requirePageController(this.deps.ctx);

    let heapUsage:
      | { jsHeapSizeUsed: number; jsHeapSizeTotal: number; jsHeapSizeLimit: number }
      | undefined;
    try {
      heapUsage = await this.deps.client.getHeapUsage();
    } catch {
      // heapUsage remains undefined
    }

    return {
      success: true,
      snapshotCount: getSnapshotCache().size,
      ...(heapUsage ? { heapUsage } : {}),
    };
  }

  async v8_bytecode_extract(args: ToolArgs): Promise<unknown> {
    const getPage = this.deps.ctx.pageController ? createPageGetter(this.deps.ctx) : undefined;
    return handleBytecodeExtract(args, {
      getPage,
    });
  }

  async v8_version_detect(_args: ToolArgs): Promise<unknown> {
    if (!this.deps.ctx.pageController) {
      return missingPageControllerResult('v8_version_detect');
    }
    const { VersionDetector } = await import('@modules/v8-inspector/VersionDetector');
    const detector = new VersionDetector(createPageGetter(this.deps.ctx));
    const version = await detector.detectV8Version();
    const supportsNativesSyntax = await detector.supportsNativesSyntax();
    return { success: true, version, features: { nativesSyntax: supportsNativesSyntax } };
  }

  async v8_jit_inspect(args: ToolArgs): Promise<unknown> {
    const getPage = this.deps.ctx.pageController ? createPageGetter(this.deps.ctx) : undefined;
    return handleJitInspect(args, {
      getPage,
    });
  }

  async v8_heap_find_leaks(args: ToolArgs): Promise<{
    success: boolean;
    snapshotId: string;
    leakCandidates: Array<{
      nodeId: number;
      name: string;
      reason: string;
      confidence: number;
      retainedSize: number;
      shallowSize: number;
      path: string[];
    }>;
    totalCandidates: number;
  }> {
    const snapshotId = requireStringArg(args, 'snapshotId');
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
      success: true,
      snapshotId,
      leakCandidates,
      totalCandidates: allLeaks.length,
    };
  }

  async v8_heap_retainers(args: ToolArgs): Promise<{
    success: boolean;
    snapshotId: string;
    chains: Record<
      number,
      Array<{
        nodeId: number;
        name: string;
        className: string;
        shallowSize: number;
        retainedSize: number;
        distance: number;
      }>
    >;
    chainCount: number;
    totalTraced: number;
  }> {
    const snapshotId = requireStringArg(args, 'snapshotId');
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
      success: true,
      snapshotId,
      chains,
      chainCount: Object.keys(chains).length,
      totalTraced: totalSteps,
    };
  }

  async v8_wasm_inspect(args: ToolArgs): Promise<{
    success: boolean;
    error?: string;
    modules: Array<{
      moduleId: number;
      url: string;
      usesGC: boolean;
      features: { gc: boolean; threads: boolean; simd: boolean };
    }>;
    totalModules: number;
    wasmScripts: Array<{ scriptId: string; url: string; byteSize?: number }>;
    summary: {
      totalWasmModules: number;
      gcModules: number;
      nonGcModules: number;
      hasGcFeature: boolean;
      hasThreadsFeature: boolean;
      hasSimdFeature: boolean;
    };
    wasmGcAvailable: boolean;
    structs?: Array<{
      moduleId: number;
      structs: Array<{ typeIndex: number; fieldCount: number; fieldMutability: boolean[] }>;
    }>;
  }> {
    const scriptId =
      typeof args.scriptId === 'string' && args.scriptId.length > 0 ? args.scriptId : undefined;
    const includeStructs = typeof args.includeStructs === 'boolean' ? args.includeStructs : true;

    if (!this.deps.ctx.pageController) {
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

    const getPage = createPageGetter(this.deps.ctx);
    const page = await getPage();
    if (!page) {
      throw new Error('No active page. Call browser_launch or browser_attach first.');
    }

    const { inspectWasmGc } = await import('@modules/v8-inspector/WasmGcInspector');
    const result = await inspectWasmGc(page, { scriptId, includeStructs });

    return {
      success: result.success,
      modules: result.modules,
      totalModules: result.totalModules,
      wasmScripts: result.wasmScripts,
      summary: result.summary,
      wasmGcAvailable: result.wasmGcAvailable,
      ...(includeStructs && result.structs.length > 0 ? { structs: result.structs } : {}),
    };
  }

  async v8_object_compare(args: ToolArgs): Promise<{
    success: boolean;
    snapshotId: string;
    anotherSnapshotId?: string;
    pairs: Array<{
      objectA: {
        nodeId: number;
        name: string;
        shallowSize: number;
        retainedSize: number;
        propertyCount: number;
      };
      objectB: {
        nodeId: number;
        name: string;
        shallowSize: number;
        retainedSize: number;
        propertyCount: number;
      };
      delta: { shallowSize: number; retainedSize: number; propertyCount: number };
      classMatch: boolean;
      sameClass: boolean;
      interesting: boolean;
    }>;
    skippedNodes?: number[];
    pairCount: number;
  }> {
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

    const snapshotId = requireStringArg(args, 'snapshotId');
    const snapshot = getSnapshot(snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }
    if (anotherSnapshotId && !getSnapshot(anotherSnapshotId)) {
      throw new Error(`Snapshot ${anotherSnapshotId} not found`);
    }

    const minDeltaBytes =
      typeof args.minDeltaBytes === 'number' && args.minDeltaBytes >= 0 ? args.minDeltaBytes : 1024;

    const { HeapSnapshotParser } = await import('@modules/v8-inspector/HeapSnapshotParser');
    const { DominatorTreeBuilder } = await import('@modules/v8-inspector/DominatorTreeBuilder');

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
      (function walk(n: any): void {
        priRetained.set(n.nodeId, n.retainedSize);
        if (n.children) for (const c of n.children) walk(c);
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
        (function walk(n: any): void {
          secRetained!.set(n.nodeId, n.retainedSize);
          if (n.children) for (const c of n.children) walk(c);
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
      classMatch: boolean;
      sameClass: boolean;
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
      success: true,
      snapshotId,
      ...(anotherSnapshotId ? { anotherSnapshotId } : {}),
      pairs,
      ...(skipped.length > 0 ? { skippedNodes: skipped } : {}),
      pairCount: pairs.length,
    };
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
