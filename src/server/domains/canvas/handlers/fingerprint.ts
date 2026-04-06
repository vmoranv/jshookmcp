/**
 * canvas_engine_fingerprint tool handler.
 *
 * Layered detection: global engine anchors → canvas context scan → RAF evidence.
 */
import type { PageController } from '@server/domains/canvas/dependencies';
import { ENGINE_ANCHORS } from './shared';

export interface FingerprintCandidate {
  engine: string;
  version?: string;
  confidence: number;
  evidence: string[];
  adapterId: string;
}

export interface CanvasMetadata {
  id: string;
  width: number;
  height: number;
  contextType: string;
  renderer?: string;
}

export interface FingerprintResult {
  candidates: FingerprintCandidate[];
  canvasCount: number;
  canvasDetails: CanvasMetadata[];
  fingerprintComplete: boolean;
}

export async function handleFingerprint(
  pageController: PageController,
  args: Record<string, unknown>,
): Promise<FingerprintResult> {
  const canvasId = args['canvasId'] as string | undefined;

  // Layer 1: scan global engine anchors via page_evaluate
  const globalScan = await pageController.evaluate<
    Array<{
      pattern: string;
      adapterId: string;
      engine: string;
      present: boolean;
      version?: string;
    }>
  >(`
    (function() {
      const results = [];
      ${ENGINE_ANCHORS.map(
        ({ pattern, adapterId, engine }) => `
        try {
          const global = window[${JSON.stringify(pattern)}];
          if (global !== undefined) {
            results.push({
              pattern: ${JSON.stringify(pattern)},
              adapterId: ${JSON.stringify(adapterId)},
              engine: ${JSON.stringify(engine)},
              present: true,
              version: (global.version || global.VERSION || global.Laya?.version || undefined)
            });
          }
        } catch(e) {}
      `,
      ).join('')}
      return results;
    })()
  `);

  const candidates: FingerprintCandidate[] = [];
  for (const hit of globalScan) {
    candidates.push({
      engine: hit.engine,
      version: hit.version,
      confidence: 0.9,
      evidence: [`global window.${hit.pattern} is defined`],
      adapterId: hit.adapterId,
    });
  }

  // Layer 2: scan canvas elements + WebGL context attributes
  const canvasInfo = await pageController.evaluate<CanvasMetadata[]>(`
    (function() {
      return Array.from(document.querySelectorAll('canvas')).map(function(c) {
        var ctx = c.getContext('webgl2') || c.getContext('webgl') || c.getContext('2d');
        var info = {
          id: c.id || '',
          width: c.width,
          height: c.height,
          contextType: ctx ? ctx.constructor.name : 'none'
        };
        if (ctx && (ctx instanceof WebGLRenderingContext || ctx instanceof WebGL2RenderingContext)) {
          var debugInfo = ctx.getExtension('WEBGL_debug_renderer_info');
          if (debugInfo) {
            info.renderer = ctx.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
          }
        }
        return info;
      });
    })()
  `);

  // Layer 3: RAF / ticker presence as secondary evidence
  const rafEvidence = await pageController.evaluate<boolean>(`
    !!(requestAnimationFrame.toString().includes('[native]') &&
       (window.__canvasEngineHint || document.querySelector('[data-engine]')))
  `);

  if (rafEvidence && candidates.length === 0) {
    candidates.push({
      engine: 'Unknown Canvas Engine',
      confidence: 0.3,
      evidence: ['requestAnimationFrame hook detected', 'canvas elements found'],
      adapterId: 'none',
    });
  }

  return {
    candidates,
    canvasCount: canvasInfo.length,
    canvasDetails:
      canvasId !== undefined
        ? canvasInfo.filter(
            (c) => c.id === canvasId || canvasInfo.indexOf(c).toString() === canvasId,
          )
        : canvasInfo,
    fingerprintComplete: candidates.length > 0,
  };
}
