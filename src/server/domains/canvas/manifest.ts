import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, ensureBrowserCore, toolLookup } from '@server/domains/shared/registry';
import { DebuggerManager } from '@server/domains/shared/modules';
import { TraceRecorder } from '@modules/trace/TraceRecorder';
import { canvasTools } from '@server/domains/canvas/definitions';
import { CanvasToolHandlers } from '@server/domains/canvas/handlers';
import { ReverseEvidenceGraph } from '@server/evidence/ReverseEvidenceGraph';
import type { CanvasDomainDependencies } from '@server/domains/canvas/dependencies';

const DOMAIN = 'canvas' as const;
const DEP_KEY = 'canvasHandlers' as const;
type H = CanvasToolHandlers;
const t = toolLookup(canvasTools);
const b = (invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);

function ensure(ctx: MCPServerContext): H {
  ensureBrowserCore(ctx);
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
  return (ctx as unknown as Record<string, unknown>).canvasHandlers as H;
}

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['full'],
  ensure,

  workflowRule: {
    patterns: [
      /(canvas|scene|engine|game).*(pick|dump|trace|reverse)/i,
      /(canvas|webgl|webgpu|scene).*(graph|tree|node)/i,
      /(laya|pixi|phaser|cocos|unity).*(reverse|scene|dump|hook)/i,
    ],
    priority: 80,
    tools: [
      'canvas_engine_fingerprint',
      'canvas_scene_dump',
      'canvas_pick_object_at_point',
      'canvas_trace_click_handler',
    ],
    hint: 'Canvas reverse: fingerprint engine → dump scene tree → pick object at point → trace click to handler',
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
  },

  registrations: [
    {
      tool: t('canvas_engine_fingerprint'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleFingerprint(a)),
    },
    {
      tool: t('canvas_scene_dump'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleSceneDump(a)),
    },
    {
      tool: t('canvas_pick_object_at_point'),
      domain: DOMAIN,
      bind: b((h, a) => h.handlePick(a)),
    },
    {
      tool: t('canvas_trace_click_handler'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleTraceClick(a)),
    },
  ],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
