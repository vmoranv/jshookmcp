/**
 * Shared utilities for canvas tool handlers.
 *
 * Engine anchor patterns, adapter registry, probe env builder, and shared helpers.
 */
import { CocosCanvasAdapter } from '@server/domains/canvas/adapters/cocos-adapter';
import { LayaCanvasAdapter } from '@server/domains/canvas/adapters/laya-adapter';
import { PhaserCanvasAdapter } from '@server/domains/canvas/adapters/phaser-adapter';
import { PixiJSCanvasAdapter } from '@server/domains/canvas/adapters/pixi-adapter';
import type { PageController } from '@server/domains/canvas/dependencies';
import type {
  CanvasDetection,
  CanvasEngineAdapter,
  CanvasProbeEnv,
} from '@server/domains/canvas/types';

/** Well-known engine global anchors and their adapter IDs. */
export const ENGINE_ANCHORS: Array<{ pattern: string; adapterId: string; engine: string }> = [
  { pattern: 'Laya', adapterId: 'laya', engine: 'LayaAir' },
  { pattern: 'PIXI', adapterId: 'pixi', engine: 'PixiJS' },
  { pattern: 'Phaser', adapterId: 'phaser', engine: 'Phaser' },
  { pattern: 'cc', adapterId: 'cocos', engine: 'CocosCreator' },
  { pattern: 'legacyCC', adapterId: 'cocos', engine: 'CocosCreator' },
  { pattern: 'BABYLON', adapterId: 'babylon', engine: 'Babylon.js' },
  { pattern: 'THREE', adapterId: 'three', engine: 'Three.js' },
  { pattern: 'createUnityInstance', adapterId: 'unity', engine: 'UnityWebGL' },
];

/** Adapter registry — registered per engine. */
const adapterRegistry = new Map<string, CanvasEngineAdapter>();

const adapterFactories: Record<string, () => CanvasEngineAdapter> = {
  laya: () => new LayaCanvasAdapter(),
  pixi: () => new PixiJSCanvasAdapter(),
  phaser: () => new PhaserCanvasAdapter(),
  cocos: () => new CocosCanvasAdapter(),
};

export function resolveAdapter(
  detection: { adapterId: string } | null | undefined,
): CanvasEngineAdapter | null {
  if (!detection) {
    return null;
  }

  if (adapterRegistry.has(detection.adapterId)) {
    return adapterRegistry.get(detection.adapterId)!;
  }
  const factory = adapterFactories[detection.adapterId];
  if (!factory) return null;

  const adapter = factory();
  adapterRegistry.set(detection.adapterId, adapter);
  return adapter;
}

export function buildEnv(pageController: PageController): CanvasProbeEnv {
  return {
    pageController,
    cdpSession: null as unknown as CanvasProbeEnv['cdpSession'],
    tabId: 'default',
  };
}

export async function fingerprintCanvas(
  pageController: PageController,
  canvasId?: string,
): Promise<CanvasDetection | null> {
  try {
    const result = await pageController.evaluate<{
      hits: Array<{
        engine: string;
        adapterId: string;
        version?: string;
      }>;
      selected: {
        engine: string;
        adapterId: string;
        version?: string;
      } | null;
      selectedEvidence: string[];
    }>(`
      (function() {
        const hits = [];
        ${ENGINE_ANCHORS.map(
          ({ pattern, adapterId, engine }) => `
          try {
            if (window[${JSON.stringify(pattern)}] !== undefined) {
              const v = window[${JSON.stringify(pattern)}];
              hits.push({
                engine: ${JSON.stringify(engine)},
                adapterId: ${JSON.stringify(adapterId)},
                version: v.version || v.VERSION || (v.Laya && v.Laya.version) || undefined
              });
            }
          } catch(e) {}
        `,
        ).join('')}

        if (hits.length === 0) {
          return { hits: hits, selected: null, selectedEvidence: [] };
        }

        var targetCanvas = null;
        if (${canvasId !== undefined}) {
          var canvases = Array.from(document.querySelectorAll('canvas'));
          var requestedId = ${JSON.stringify(canvasId ?? null)};
          var requestedIndex = Number.parseInt(requestedId, 10);
          targetCanvas =
            document.getElementById(requestedId) ||
            (Number.isNaN(requestedIndex) ? null : canvases[requestedIndex] || null);
        }

        if (!targetCanvas || hits.length === 1) {
          return { hits: hits, selected: hits[0] || null, selectedEvidence: [] };
        }

        function canvasEquals(candidate) {
          return candidate === targetCanvas;
        }

        function collectCanvasEvidence(adapterId) {
          var evidence = [];

          if (adapterId === 'pixi') {
            if (targetCanvas._pixiApp) {
              evidence.push('target canvas owns _pixiApp');
            }
            if (window.__pixiApp && canvasEquals(window.__pixiApp.view)) {
              evidence.push('target canvas matches window.__pixiApp.view');
            }
            if (window.__PIXI_APP__ && canvasEquals(window.__PIXI_APP__.view)) {
              evidence.push('target canvas matches window.__PIXI_APP__.view');
            }
          }

          if (adapterId === 'phaser' && window.Phaser && Array.isArray(window.Phaser.GAMES)) {
            if (window.Phaser.GAMES.some(function(game) { return game && canvasEquals(game.canvas); })) {
              evidence.push('target canvas matches Phaser.GAMES[].canvas');
            }
          }

          if (adapterId === 'cocos') {
            var cocos = window.cc || window.legacyCC;
            var game = cocos && cocos.game;
            if (game) {
              if (canvasEquals(game.canvas) || canvasEquals(game._canvas)) {
                evidence.push('target canvas matches cc.game canvas');
              }
              if (game.container && typeof game.container.contains === 'function' && game.container.contains(targetCanvas)) {
                evidence.push('target canvas is inside cc.game.container');
              }
            }
          }

          if (adapterId === 'laya' && window.Laya) {
            var candidates = [
              window.Laya.Browser && window.Laya.Browser.canvas,
              window.Laya.Render && window.Laya.Render._mainCanvas && (window.Laya.Render._mainCanvas.source || window.Laya.Render._mainCanvas._source || window.Laya.Render._mainCanvas),
              window.Laya.Render && window.Laya.Render._context && window.Laya.Render._context.canvas && (window.Laya.Render._context.canvas.source || window.Laya.Render._context.canvas),
              window.Laya.stage && window.Laya.stage._canvas && (window.Laya.stage._canvas.source || window.Laya.stage._canvas._source || window.Laya.stage._canvas),
              window.Laya.stage && window.Laya.stage.canvas && (window.Laya.stage.canvas.source || window.Laya.stage.canvas._source || window.Laya.stage.canvas)
            ].filter(Boolean);
            if (candidates.some(canvasEquals)) {
              evidence.push('target canvas matches Laya render canvas');
            }
          }

          return evidence;
        }

        for (var i = 0; i < hits.length; i++) {
          var selectedEvidence = collectCanvasEvidence(hits[i].adapterId);
          if (selectedEvidence.length > 0) {
            return {
              hits: hits,
              selected: hits[i],
              selectedEvidence: selectedEvidence
            };
          }
        }

        return { hits: hits, selected: hits[0] || null, selectedEvidence: [] };
      })()
    `);

    if (!result.selected) return null;
    const hit = result.selected;
    return {
      engine: hit.engine,
      version: hit.version,
      confidence: result.selectedEvidence.length > 0 ? 0.95 : 0.9,
      evidence: ['window global detected', ...result.selectedEvidence],
      adapterId: hit.adapterId,
    };
  } catch {
    return null;
  }
}
