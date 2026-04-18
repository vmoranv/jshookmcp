import { skiaTools } from '@server/domains/skia-capture/definitions';
import { SkiaCaptureHandlers } from '@server/domains/skia-capture/handlers';
import { asJsonResponse } from '@server/domains/shared/response';
import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, toolLookup } from '@server/domains/shared/registry';

const DOMAIN = 'skia-capture' as const;
const DEP_KEY = 'skiaCaptureHandlers' as const;
const PROFILES: Array<'full'> = ['full'];

type H = SkiaCaptureHandlers;

const lookup = toolLookup(skiaTools);
const bind = (invoke: (handler: H, args: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, async (handler, args) => {
    return asJsonResponse(await invoke(handler, args));
  });

function ensure(ctx: MCPServerContext): H {
  const existing = ctx.getDomainInstance<SkiaCaptureHandlers>(DEP_KEY);
  if (existing) {
    return existing;
  }

  const handlers = new SkiaCaptureHandlers({
    pageController: ctx.pageController ?? null,
    eventBus: ctx.eventBus,
  });
  ctx.setDomainInstance(DEP_KEY, handlers);
  return handlers;
}

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: PROFILES,
  registrations: [
    {
      tool: lookup('skia_detect_renderer'),
      domain: DOMAIN,
      bind: bind((handler, args) => handler.handleSkiaDetectRenderer(args)),
    },
    {
      tool: lookup('skia_extract_scene'),
      domain: DOMAIN,
      bind: bind((handler, args) => handler.handleSkiaExtractScene(args)),
    },
    {
      tool: lookup('skia_correlate_objects'),
      domain: DOMAIN,
      bind: bind((handler, args) => handler.handleSkiaCorrelateObjects(args)),
    },
  ],
  ensure,
  workflowRule: {
    patterns: [
      /\b(skia|gpu|render(er)?|scene\s?(tree|graph)|draw\s?call|raster|paint|layer)\b/i,
      /skia.*(render|detect|scene)/i,
      /canvas.*skia/i,
      /gpu.*backend/i,
    ],
    priority: 78,
    tools: ['skia_detect_renderer', 'skia_extract_scene', 'skia_correlate_objects'],
    hint: 'Skia pipeline analysis: detect GPU backend → dump scene tree → correlate with JS objects.',
  },
  prerequisites: {
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
      from: 'canvas',
      to: 'skia-capture',
      relation: 'uses',
      weight: 0.9,
    },
    {
      from: 'skia_correlate_objects',
      to: 'v8_heap_snapshot_capture',
      relation: 'precedes',
      weight: 0.6,
    },
  ],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
