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
    };

    const handler = dispatchTable[toolName];
    if (!handler) {
      throw new Error(`Unknown v8-inspector tool: ${toolName}`);
    }
    return handler(args);
  }

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
    const includeDominatorTree = typeof args.includeDominatorTree === 'boolean'
      ? args.includeDominatorTree
      : false;
    const dominatorTreeDepth = typeof args.depth === 'number' && args.depth > 0
      ? args.depth
      : 3;
    const includeLeakDetection = typeof args.includeLeakDetection === 'boolean'
      ? args.includeLeakDetection
      : false;
    const minLeakSize = typeof args.minLeakSize === 'number' && args.minLeakSize > 0
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

    return {
      success: true,
      beforeSnapshotId,
      afterSnapshotId,
      sizeDeltaBytes: afterSnapshot.sizeBytes - beforeSnapshot.sizeBytes,
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
