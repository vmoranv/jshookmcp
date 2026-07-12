import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import {
  defineMethodRegistrations,
  ensureBrowserCore,
  toolLookup,
} from '@server/domains/shared/registry';
import { canvasTools } from '@server/domains/canvas/definitions';
import { skiaTools } from '@server/domains/canvas/skia/definitions';
import type { CanvasToolHandlers } from '@server/domains/canvas/handlers';
import type { SkiaCaptureHandlers } from '@server/domains/canvas/skia';
import type { ReverseEvidenceGraph } from '@server/evidence/ReverseEvidenceGraph';
import type { CanvasDomainDependencies } from '@server/domains/canvas/dependencies';

const DOMAIN = 'canvas' as const;
const DEP_KEY = 'canvasHandlers' as const;
const SKIA_DEP_KEY = 'skiaCaptureHandlers' as const;
type H = CanvasToolHandlers;
type SK = SkiaCaptureHandlers;
const t = toolLookup([...canvasTools, ...skiaTools]);
const registrations = defineMethodRegistrations<H, (typeof canvasTools)[number]['name']>({
  domain: DOMAIN,
  depKey: DEP_KEY,
  lookup: t,
  entries: [
    { tool: 'canvas_engine_fingerprint', method: 'handleFingerprintTool', profiles: ['full'] },
    { tool: 'canvas_scene_dump', method: 'handleSceneDumpTool', profiles: ['full'] },
    { tool: 'canvas_pick_object_at_point', method: 'handlePickTool', profiles: ['full'] },
    { tool: 'canvas_trace_click_handler', method: 'handleTraceClickTool', profiles: ['full'] },
    { tool: 'canvas_scene_search', method: 'handleSceneSearchTool', profiles: ['full'] },
    { tool: 'canvas_inject_draw_hook', method: 'handleDrawHookTool', profiles: ['full'] },
  ],
});
const skiaRegistrations = defineMethodRegistrations<SK, (typeof skiaTools)[number]['name']>({
  domain: DOMAIN,
  depKey: SKIA_DEP_KEY,
  lookup: t,
  entries: [
    { tool: 'skia_detect_renderer', method: 'handleSkiaDetectRendererTool' },
    { tool: 'skia_extract_scene', method: 'handleSkiaExtractSceneTool' },
    { tool: 'skia_correlate_objects', method: 'handleSkiaCorrelateObjectsTool' },
  ],
});

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { DebuggerManager } = await import('@server/domains/shared/modules');
  const { TraceRecorder } = await import('@modules/trace/TraceRecorder');
  const { ReverseEvidenceGraph } = await import('@server/evidence/ReverseEvidenceGraph');
  const { CanvasToolHandlers, SkiaCaptureHandlers } = await import('@server/domains/canvas/index');

  await ensureBrowserCore(ctx);
  if (!ctx.debuggerManager) ctx.debuggerManager = new DebuggerManager(ctx.collector!);
  if (!ctx.traceRecorder) ctx.traceRecorder = new TraceRecorder();
  let graph = ctx.getDomainInstance<ReverseEvidenceGraph>('evidenceGraph');
  if (!graph) {
    graph = new ReverseEvidenceGraph();
    ctx.setDomainInstance('evidenceGraph', graph);
  }
  if (!(ctx as unknown as Record<string, unknown>).canvasHandlers) {
    const deps: CanvasDomainDependencies = {
      pageController: ctx.pageController!,
      debuggerManager: ctx.debuggerManager,
      traceRecorder: ctx.traceRecorder,
      evidenceStore: graph,
    };
    (ctx as unknown as Record<string, unknown>).canvasHandlers = new CanvasToolHandlers(deps);
  }
  if (!ctx.skiaCaptureHandlers) {
    ctx.skiaCaptureHandlers = new SkiaCaptureHandlers({
      pageController: ctx.pageController ?? null,
      eventBus: ctx.eventBus,
    });
  }
  return (ctx as unknown as Record<string, unknown>).canvasHandlers as H;
}

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  secondaryDepKeys: ['skiaCaptureHandlers'],
  profiles: ['workflow', 'full'],
  ensure,

  workflowRule: {
    patterns: [
      /(canvas|scene|engine|game).*(pick|dump|trace|reverse)/i,
      /(canvas|webgl|webgpu|scene).*(graph|tree|node)/i,
      /(laya|pixi|phaser|cocos|unity).*(reverse|scene|dump|hook)/i,
      /\b(skia|gpu|render(er)?|scene\s?(tree|graph)|draw\s?call|raster|paint|layer)\b/i,
      /skia.*(render|detect|scene)/i,
      /gpu.*backend/i,
    ],
    priority: 80,
    tools: [
      'canvas_engine_fingerprint',
      'canvas_scene_dump',
      'canvas_pick_object_at_point',
      'canvas_trace_click_handler',
      'canvas_inject_draw_hook',
      'skia_detect_renderer',
      'skia_extract_scene',
      'skia_correlate_objects',
    ],
    hint: 'Canvas/Skia reverse: fingerprint engine → dump scene tree → pick object at point → trace click; or detect Skia GPU backend → extract scene → correlate with JS objects.',
  },

  prerequisites: {
    canvas_engine_fingerprint: [
      {
        condition: 'Browser must be running',
        fix: 'Call browser_launch or browser_attach first',
      },
    ],
    canvas_scene_dump: [
      {
        condition: 'Browser must be running',
        fix: 'Call browser_launch or browser_attach first',
      },
    ],
    canvas_pick_object_at_point: [
      {
        condition: 'Browser must be running',
        fix: 'Call browser_launch or browser_attach first',
      },
    ],
    canvas_trace_click_handler: [
      {
        condition: 'Debugger must be enabled',
        fix: "Call debugger_lifecycle({ action: 'enable' }) first",
      },
    ],
    canvas_inject_draw_hook: [
      {
        condition: 'Browser must be running',
        fix: 'Call browser_launch or browser_attach first',
      },
    ],
    skia_detect_renderer: [
      {
        condition: 'Browser must be running with CDP attached',
        fix: 'Call browser_launch or browser_attach first',
      },
    ],
    skia_extract_scene: [
      {
        condition: 'Browser must be running with CDP attached',
        fix: 'Call browser_launch or browser_attach first',
      },
    ],
    skia_correlate_objects: [
      {
        condition: 'V8 heap snapshot should be available for robust matching',
        fix: 'Run v8_heap_snapshot_capture before correlation',
      },
    ],
  },

  toolDependencies: [
    {
      from: 'skia_correlate_objects',
      to: 'v8_heap_snapshot_capture',
      relation: 'precedes',
      weight: 0.6,
    },
  ],

  registrations: [...registrations, ...skiaRegistrations],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
