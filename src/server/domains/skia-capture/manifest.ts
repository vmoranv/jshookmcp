/**
 * Domain manifest for skia-capture.
 *
 * Provides Skia rendering pipeline analysis tools:
 * - SKIA-01: skia_detect_renderer — fingerprint Skia renderer
 * - SKIA-02: skia_dump_scene — extract scene tree
 * - SKIA-03: skia_correlate_objects — correlate Skia to JS objects
 */
import type { MCPServerContext } from '@server/MCPServer.context';
import type { DomainManifest, ToolRegistration } from '@server/registry/contracts';
import { skiaCaptureTools } from './definitions';
import { SkiaCaptureHandlers } from './handlers';

const registrations: ToolRegistration[] = skiaCaptureTools.map((t) => ({
  tool: t,
  bind: (deps) => {
    const handlers = deps.skiaCaptureHandlers as SkiaCaptureHandlers;
    const method = t.name as keyof SkiaCaptureHandlers;
    return async (args: Record<string, unknown>) => {
      const handler = handlers[method];
      if (typeof handler !== 'function') {
        throw new Error(`Unknown skia-capture tool: ${t.name}`);
      }
      return (handler as (args: Record<string, unknown>) => Promise<unknown>)(args);
    };
  },
}));

async function ensure(ctx: MCPServerContext): Promise<SkiaCaptureHandlers> {
  const pageController = ctx.pageController;
  if (!pageController) {
    throw new Error(
      'skia-capture: PageController not available. Ensure the browser domain is connected.',
    );
  }

  // Try to get JS objects from v8-inspector domain (graceful degradation)
  const getJSObjects = async () => {
    const v8Domain = ctx.v8InspectorHandlers as
      | { getHeapSnapshot?: (args: Record<string, unknown>) => Promise<unknown> }
      | undefined;
    if (!v8Domain?.getHeapSnapshot) {
      throw new Error('v8-inspector not available');
    }
    // Parse heap snapshot and return JS objects — delegated to correlator
    return [];
  };

  const handlers = new SkiaCaptureHandlers({
    pageController,
    getJSObjects,
  });

  (ctx as unknown as Record<string, unknown>).skiaCaptureHandlers = handlers;
  return handlers;
}

const manifest: DomainManifest<'skiaCaptureHandlers', SkiaCaptureHandlers, 'skia-capture'> = {
  kind: 'domain-manifest',
  version: 1,
  domain: 'skia-capture',
  depKey: 'skiaCaptureHandlers',
  profiles: ['workflow', 'full'],
  registrations,
  ensure,
  toolDependencies: [
    {
      from: 'skia_detect_renderer',
      to: 'browser_attach',
      relation: 'requires',
      weight: 0.8,
    },
    {
      from: 'skia_dump_scene',
      to: 'browser_attach',
      relation: 'requires',
      weight: 0.8,
    },
    {
      from: 'skia_correlate_objects',
      to: 'v8_heap_snapshot_capture',
      relation: 'precedes',
      weight: 0.6,
    },
  ],
  prerequisites: {
    skia_detect_renderer: [
      {
        condition: 'Browser must be running',
        fix: 'Call browser_launch or browser_attach first',
      },
    ],
    skia_dump_scene: [
      {
        condition: 'Browser must be running',
        fix: 'Call browser_launch or browser_attach first',
      },
    ],
    skia_correlate_objects: [
      {
        condition: 'Browser must be running',
        fix: 'Call browser_launch or browser_attach first',
      },
      {
        condition: 'V8 heap snapshot should be captured for correlation',
        fix: 'Call v8_heap_snapshot_capture before skia_correlate_objects',
      },
    ],
  },
  workflowRule: {
    patterns: [
      /skia.*render/i,
      /skia.*detect/i,
      /skia.*scene/i,
      /canvas.*skia/i,
      /render.*pipeline/i,
      /gpu.*backend/i,
    ],
    priority: 70,
    tools: ['skia_detect_renderer', 'skia_dump_scene', 'skia_correlate_objects'],
    hint: 'Skia rendering analysis: detect renderer → dump scene tree → correlate with JS objects',
  },
};

export default manifest;
