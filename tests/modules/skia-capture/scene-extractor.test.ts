import { describe, it, expect, vi } from 'vitest';
import { detectSkiaRenderer, extractSceneTree } from '@modules/skia-capture/SkiaSceneExtractor';
import type { PageController } from '@server/domains/shared/modules';

// Create a mock PageController
function createMockPageController(evaluations: Record<string, unknown>): PageController {
  return {
    evaluate: vi.fn(async (script: string) => {
      // Check for extractSceneTree script first (long script with drawCommands)
      if (script.includes('drawCommands') && script.includes('canvasMeta')) {
        return evaluations.scene ?? { canvas: {}, layers: [], drawCommands: [] };
      }
      // detectSkiaRenderer scripts
      if (script.includes('UNMASKED_RENDERER_WEBGL')) {
        return evaluations.webgl ?? [];
      }
      if (script.includes('fontBoundingBoxAscent')) {
        return evaluations.font ?? { hasSkiaFontSignatures: false, textMetrics: null };
      }
      if (script.includes('window.cc') || script.includes('window.legacyCC')) {
        return evaluations.engine ?? { engines: [], isSkiaEngine: false };
      }
      return null;
    }),
  } as unknown as PageController;
}

describe('SkiaSceneExtractor', () => {
  describe('detectSkiaRenderer', () => {
    it('should detect Skia when ANGLE backend is present', async () => {
      const mockPC = createMockPageController({
        webgl: [
          {
            vendor: 'Google Inc. (NVIDIA)',
            renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080)',
            unmaskedVendor: 'Google Inc. (NVIDIA)',
            unmaskedRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0)',
            hasSkiaBackend: true,
          },
        ],
        font: { hasSkiaFontSignatures: true, textMetrics: { width: 42 } },
        engine: { engines: ['CocosCreator'], isSkiaEngine: true },
      });

      const result = await detectSkiaRenderer(mockPC);

      expect(result.isSkiaBacked).toBe(true);
      expect(result.gpuBackend).toBe('gl');
      expect(result.shaderPipeline).toBe('OpenGL');
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.rendererStrings.length).toBeGreaterThan(0);
      expect(result.evidence.length).toBeGreaterThan(0);
    });

    it('should detect Skia with SwiftShader software backend', async () => {
      const mockPC = createMockPageController({
        webgl: [
          {
            vendor: 'Google Inc.',
            renderer: 'Google SwiftShader',
            unmaskedVendor: 'Google Inc.',
            unmaskedRenderer: 'Google SwiftShader',
            hasSkiaBackend: true,
          },
        ],
        font: { hasSkiaFontSignatures: false, textMetrics: null },
        engine: { engines: [], isSkiaEngine: false },
      });

      const result = await detectSkiaRenderer(mockPC);

      expect(result.isSkiaBacked).toBe(true);
      expect(result.gpuBackend).toBe('software');
      expect(result.shaderPipeline).toBe('Raster');
    });

    it('should detect Skia with Mesa backend', async () => {
      const mockPC = createMockPageController({
        webgl: [
          {
            vendor: 'Mesa',
            renderer: 'Mesa DRI Intel(R) HD Graphics',
            unmaskedVendor: 'Intel Open Source Technology Center',
            unmaskedRenderer: 'Mesa DRI Intel(R) HD Graphics',
            hasSkiaBackend: true,
          },
        ],
        font: { hasSkiaFontSignatures: false, textMetrics: null },
        engine: { engines: [], isSkiaEngine: false },
      });

      const result = await detectSkiaRenderer(mockPC);

      expect(result.isSkiaBacked).toBe(true);
      expect(result.gpuBackend).toBe('gl');
    });

    it('should detect Skia with Vulkan backend', async () => {
      const mockPC = createMockPageController({
        webgl: [
          {
            vendor: 'Google',
            renderer: 'Vulkan (SwiftShader)',
            unmaskedVendor: 'Google',
            unmaskedRenderer: 'Vulkan (SwiftShader Device)',
            hasSkiaBackend: true,
          },
        ],
        font: { hasSkiaFontSignatures: false, textMetrics: null },
        engine: { engines: [], isSkiaEngine: false },
      });

      const result = await detectSkiaRenderer(mockPC);

      expect(result.isSkiaBacked).toBe(true);
      expect(result.shaderPipeline).toBe('Vulkan');
    });

    it('should detect Skia with Metal backend', async () => {
      const mockPC = createMockPageController({
        webgl: [
          {
            vendor: 'Apple',
            renderer: 'Apple M1',
            unmaskedVendor: 'Apple',
            unmaskedRenderer: 'Metal (Apple M1)',
            hasSkiaBackend: true,
          },
        ],
        font: { hasSkiaFontSignatures: false, textMetrics: null },
        engine: { engines: [], isSkiaEngine: false },
      });

      const result = await detectSkiaRenderer(mockPC);

      expect(result.isSkiaBacked).toBe(true);
      expect(result.gpuBackend).toBe('metal');
      expect(result.shaderPipeline).toBe('Metal');
    });

    it('should return non-Skia when no evidence found', async () => {
      const mockPC = createMockPageController({
        webgl: [
          {
            vendor: 'Unknown',
            renderer: 'Generic Renderer',
            unmaskedVendor: 'Unknown',
            unmaskedRenderer: 'Generic Renderer',
            hasSkiaBackend: false,
          },
        ],
        font: { hasSkiaFontSignatures: false, textMetrics: null },
        engine: { engines: [], isSkiaEngine: false },
      });

      const result = await detectSkiaRenderer(mockPC);

      expect(result.isSkiaBacked).toBe(false);
      expect(result.gpuBackend).toBe('software');
      expect(result.shaderPipeline).toBe('Raster');
      expect(result.confidence).toBeLessThan(0.5);
    });

    it('should detect Cocos Creator as known Skia engine', async () => {
      const mockPC = createMockPageController({
        webgl: [
          {
            vendor: 'Unknown',
            renderer: 'Generic',
            unmaskedVendor: 'Unknown',
            unmaskedRenderer: 'Generic',
            hasSkiaBackend: false,
          },
        ],
        font: { hasSkiaFontSignatures: false, textMetrics: null },
        engine: { engines: ['CocosCreator'], isSkiaEngine: true },
      });

      const result = await detectSkiaRenderer(mockPC);

      expect(result.isSkiaBacked).toBe(true);
      expect(result.features).toContain('engine:CocosCreator');
    });

    it('should detect LayaAir as known Skia engine', async () => {
      const mockPC = createMockPageController({
        webgl: [
          {
            vendor: 'Unknown',
            renderer: 'Generic',
            unmaskedVendor: 'Unknown',
            unmaskedRenderer: 'Generic',
            hasSkiaBackend: false,
          },
        ],
        font: { hasSkiaFontSignatures: false, textMetrics: null },
        engine: { engines: ['LayaAir'], isSkiaEngine: true },
      });

      const result = await detectSkiaRenderer(mockPC);

      expect(result.isSkiaBacked).toBe(true);
      expect(result.features).toContain('engine:LayaAir');
    });

    it('should include font bounding box feature when available', async () => {
      const mockPC = createMockPageController({
        webgl: [
          {
            vendor: 'Unknown',
            renderer: 'Generic',
            unmaskedVendor: 'Unknown',
            unmaskedRenderer: 'Generic',
            hasSkiaBackend: false,
          },
        ],
        font: { hasSkiaFontSignatures: true, textMetrics: null },
        engine: { engines: [], isSkiaEngine: false },
      });

      const result = await detectSkiaRenderer(mockPC);

      expect(result.isSkiaBacked).toBe(true);
      expect(result.features).toContain('fontBoundingBoxAscent/Descent available');
    });

    it('should handle empty canvas array', async () => {
      const mockPC = createMockPageController({
        webgl: [],
        font: { hasSkiaFontSignatures: false, textMetrics: null },
        engine: { engines: [], isSkiaEngine: false },
      });

      const result = await detectSkiaRenderer(mockPC);

      expect(result.isSkiaBacked).toBe(false);
      expect(result.rendererStrings).toEqual([]);
    });

    it('should extract version from renderer string', async () => {
      const mockPC = createMockPageController({
        webgl: [
          {
            vendor: 'Google',
            renderer: 'ANGLE 12.0.1',
            unmaskedVendor: 'Google',
            unmaskedRenderer: 'ANGLE 12.0.1 (NVIDIA)',
            hasSkiaBackend: true,
          },
        ],
        font: { hasSkiaFontSignatures: false, textMetrics: null },
        engine: { engines: [], isSkiaEngine: false },
      });

      const result = await detectSkiaRenderer(mockPC);

      expect(result.version).toBe('12.0.1');
    });

    it('should accept canvasId parameter', async () => {
      const mockPC = createMockPageController({
        webgl: [
          {
            vendor: 'Google',
            renderer: 'ANGLE',
            unmaskedVendor: 'Google',
            unmaskedRenderer: 'ANGLE (NVIDIA)',
            hasSkiaBackend: true,
          },
        ],
        font: { hasSkiaFontSignatures: false, textMetrics: null },
        engine: { engines: [], isSkiaEngine: false },
      });

      const result = await detectSkiaRenderer(mockPC, 'my-canvas');

      expect(result.isSkiaBacked).toBe(true);
      expect(mockPC.evaluate).toHaveBeenCalled();
    });
  });

  describe('extractSceneTree', () => {
    it('should extract basic scene tree from canvas elements', async () => {
      const mockPC = createMockPageController({
        scene: {
          canvas: { id: 'game-canvas', width: 1920, height: 1080, dpr: 1, contextType: 'webgl' },
          layers: [
            {
              id: 'layer_root',
              name: 'root_canvas',
              bounds: { x: 0, y: 0, width: 1920, height: 1080 },
              transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
              opacity: 1,
              visible: true,
              parentId: null,
              customData: {},
            },
          ],
          drawCommands: [
            {
              type: 'drawRect',
              bounds: { x: 0, y: 0, width: 1920, height: 1080 },
              paintInfo: { fillStyle: '#1a1a2e' },
            },
          ],
        },
        webgl: [],
        font: { hasSkiaFontSignatures: false, textMetrics: null },
        engine: { engines: [], isSkiaEngine: false },
      });

      const result = await extractSceneTree(mockPC);

      expect(result.rootLayer).not.toBeNull();
      expect(result.layers.length).toBeGreaterThan(0);
      expect(result.totalLayers).toBe(result.layers.length);
      expect(result.totalDrawCommands).toBe(result.drawCommands.length);
      expect(result.canvas.width).toBe(1920);
      expect(result.canvas.height).toBe(1080);
    });

    it('should extract draw commands when includeDrawCommands is true', async () => {
      const mockPC = createMockPageController({
        scene: {
          canvas: { width: 800, height: 600, dpr: 1, contextType: '2d' },
          layers: [],
          drawCommands: [
            {
              type: 'drawText',
              bounds: { x: 10, y: 20, width: 100, height: 30 },
              paintInfo: { text: 'Hello' },
            },
            {
              type: 'drawImage',
              bounds: { x: 0, y: 0, width: 256, height: 256 },
              paintInfo: { src: 'sprite.png' },
            },
          ],
        },
        webgl: [],
        font: { hasSkiaFontSignatures: false, textMetrics: null },
        engine: { engines: [], isSkiaEngine: false },
      });

      const result = await extractSceneTree(mockPC, undefined, true);

      expect(result.drawCommands.length).toBe(2);
      expect(result.drawCommands[0]).toBeDefined();
      expect(result.drawCommands[0]!.type).toBe('drawText');
      expect(result.drawCommands[1]).toBeDefined();
      expect(result.drawCommands[1]!.type).toBe('drawImage');
    });

    it('should normalize draw command types', async () => {
      const mockPC = createMockPageController({
        scene: {
          canvas: { width: 800, height: 600, dpr: 1, contextType: '2d' },
          layers: [],
          drawCommands: [
            { type: 'DrawCircle', bounds: { x: 0, y: 0, width: 50, height: 50 }, paintInfo: {} },
            { type: 'DrawRRect', bounds: { x: 0, y: 0, width: 100, height: 50 }, paintInfo: {} },
            { type: 'draw_line', bounds: { x: 0, y: 0, width: 100, height: 100 }, paintInfo: {} },
            { type: 'unknown_type', bounds: { x: 0, y: 0, width: 0, height: 0 }, paintInfo: {} },
          ],
        },
        webgl: [],
        font: { hasSkiaFontSignatures: false, textMetrics: null },
        engine: { engines: [], isSkiaEngine: false },
      });

      const result = await extractSceneTree(mockPC);

      expect(result.drawCommands[0]!.type).toBe('drawCircle');
      expect(result.drawCommands[1]!.type).toBe('drawRRect');
      expect(result.drawCommands[2]!.type).toBe('drawLine');
      expect(result.drawCommands[3]!.type).toBe('unknown');
    });

    it('should handle empty scene', async () => {
      const mockPC = createMockPageController({
        scene: {
          canvas: { width: 0, height: 0, dpr: 1, contextType: 'unknown' },
          layers: [],
          drawCommands: [],
        },
        webgl: [],
        font: { hasSkiaFontSignatures: false, textMetrics: null },
        engine: { engines: [], isSkiaEngine: false },
      });

      const result = await extractSceneTree(mockPC);

      expect(result.rootLayer).toBeNull();
      expect(result.layers).toEqual([]);
      expect(result.drawCommands).toEqual([]);
      expect(result.totalLayers).toBe(0);
      expect(result.totalDrawCommands).toBe(0);
    });

    it('should build parent-child relationships based on bounds containment', async () => {
      const mockPC = createMockPageController({
        scene: {
          canvas: { width: 1920, height: 1080, dpr: 1, contextType: 'webgl' },
          layers: [
            {
              id: 'layer_root',
              name: 'root',
              bounds: { x: 0, y: 0, width: 1920, height: 1080 },
              transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
              opacity: 1,
              visible: true,
              parentId: null,
              customData: {},
            },
            {
              id: 'layer_child',
              name: 'child',
              bounds: { x: 100, y: 100, width: 200, height: 200 },
              transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
              opacity: 0.8,
              visible: true,
              parentId: null,
              customData: {},
            },
          ],
          drawCommands: [],
        },
        webgl: [],
        font: { hasSkiaFontSignatures: false, textMetrics: null },
        engine: { engines: [], isSkiaEngine: false },
      });

      const result = await extractSceneTree(mockPC);

      expect(result.rootLayer).not.toBeNull();
      expect(result.rootLayer!.children.length).toBe(1);
      expect(result.rootLayer!.children[0]!.name).toBe('child');
    });
  });
});
