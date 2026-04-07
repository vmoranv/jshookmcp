import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PageController } from '@server/domains/shared/modules';

vi.mock('@modules/skia-capture/SkiaSceneExtractor', () => {
  const detectSkiaRenderer = vi.fn().mockResolvedValue({
    isSkiaBacked: true,
    version: '1.0',
    gpuBackend: 'gl',
    shaderPipeline: 'OpenGL',
    rendererStrings: ['ANGLE'],
    features: [],
    confidence: 0.9,
    evidence: ['test'],
  });
  const extractSceneTree = vi.fn().mockResolvedValue({
    rootLayer: {
      id: 'root',
      name: 'root',
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      transform: [],
      opacity: 1,
      visible: true,
      children: [],
    },
    layers: [
      {
        id: 'root',
        name: 'root',
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        transform: [],
        opacity: 1,
        visible: true,
        children: [],
      },
    ],
    drawCommands: [
      { type: 'drawRect', bounds: { x: 0, y: 0, width: 800, height: 600 }, paintInfo: {} },
    ],
    totalLayers: 1,
    totalDrawCommands: 1,
    canvas: { width: 800, height: 600, dpr: 1, contextType: '2d' },
  });
  return {
    detectSkiaRenderer,
    extractSceneTree,
  };
});

let SkiaCaptureHandlers: typeof import('@server/domains/skia-capture/handlers').SkiaCaptureHandlers;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('@server/domains/skia-capture/handlers');
  SkiaCaptureHandlers = mod.SkiaCaptureHandlers;
});

function makeMockPC(): PageController {
  return { evaluate: vi.fn() } as unknown as PageController;
}

describe('SkiaCaptureHandlers', () => {
  describe('handleDetectRenderer', () => {
    it('should throw when pageController is missing', async () => {
      const handlers = new SkiaCaptureHandlers({ pageController: null });
      await expect(handlers.handleDetectRenderer({})).rejects.toThrow(
        'PageController not available',
      );
    });

    it('should call detectRenderer successfully', async () => {
      const handlers = new SkiaCaptureHandlers({ pageController: makeMockPC() });
      const result = await handlers.handleDetectRenderer({});
      expect(result).toHaveProperty('rendererInfo');
      expect(result).toHaveProperty('detectionComplete', true);
    });
  });

  describe('handleDumpScene', () => {
    it('should throw when pageController is missing', async () => {
      const handlers = new SkiaCaptureHandlers({ pageController: null });
      await expect(handlers.handleDumpScene({})).rejects.toThrow('PageController not available');
    });

    it('should call dumpScene successfully', async () => {
      const handlers = new SkiaCaptureHandlers({ pageController: makeMockPC() });
      const result = await handlers.handleDumpScene({});
      expect(result).toHaveProperty('sceneTree');
      expect(result).toHaveProperty('extractionComplete', true);
    });
  });

  describe('handleCorrelateObjects', () => {
    it('should throw when pageController is missing', async () => {
      const handlers = new SkiaCaptureHandlers({ pageController: null });
      await expect(handlers.handleCorrelateObjects({})).rejects.toThrow(
        'PageController not available',
      );
    });
  });
});
