import { skiaTools } from '@server/domains/skia-capture/definitions';
import { SkiaCaptureHandlers } from '@server/domains/skia-capture/handlers';
import { asJsonResponse } from '@server/domains/shared/response';
import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, toolLookup } from '@server/domains/shared/registry';

const DOMAIN = 'skia-capture' as const;
const DEP_KEY = 'skiaCaptureHandlers' as const;
const PROFILES: Array<'workflow' | 'full'> = ['workflow', 'full'];

type H = SkiaCaptureHandlers;

const lookup = toolLookup(skiaTools);
const bind = (invoke: (handler: H, args: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, async (handler, args) => {
    try {
      return asJsonResponse(await invoke(handler, args));
    } catch (error) {
      throw error;
    }
  });

function ensure(ctx: MCPServerContext): H {
  const existing = ctx.getDomainInstance<SkiaCaptureHandlers>(DEP_KEY);
  if (existing) {
    return existing;
  }

  const handlers = new SkiaCaptureHandlers({
    pageController: ctx.pageController ?? null,
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
  toolDependencies: [
    {
      from: 'canvas',
      to: 'skia-capture',
      relation: 'uses',
      weight: 0.9,
    },
  ],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
