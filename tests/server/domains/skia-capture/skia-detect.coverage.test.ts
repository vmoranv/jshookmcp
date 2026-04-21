import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDetectSkiaRenderer = vi.fn().mockResolvedValue({
  isSkiaBacked: true,
  version: 'm116',
  gpuBackend: 'gl',
});

const mockExtractSceneTree = vi.fn().mockResolvedValue({
  layers: [{ id: 'layer1', type: 'layer', bounds: { x: 0, y: 0, w: 100, h: 100 } }],
  drawCommands: [{ type: 'drawRect', layerId: 'layer1' }],
  totalLayers: 1,
  totalDrawCommands: 1,
});

const mockCorrelateToJS = vi
  .fn()
  .mockReturnValue([{ skiaId: 'layer1', jsObjectId: 'obj1', confidence: 0.9 }]);

vi.mock('@modules/skia-capture/SkiaSceneExtractor', () => ({
  detectSkiaRenderer: (...args: any[]) => mockDetectSkiaRenderer(...args),
  extractSceneTree: (...args: any[]) => mockExtractSceneTree(...args),
}));

vi.mock('@modules/skia-capture/SkiaObjectCorrelator', () => ({
  correlateToJS: (...args: any[]) => mockCorrelateToJS(...args),
}));

const mockPageController = { evaluate: vi.fn() } as any;

describe('skia-detect handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDetectSkiaRenderer.mockResolvedValue({
      isSkiaBacked: true,
      version: 'm116',
      gpuBackend: 'gl',
    });
    mockExtractSceneTree.mockResolvedValue({
      layers: [{ id: 'layer1', type: 'layer', bounds: { x: 0, y: 0, w: 100, h: 100 } }],
      drawCommands: [{ type: 'drawRect', layerId: 'layer1' }],
      totalLayers: 1,
      totalDrawCommands: 1,
    });
    mockCorrelateToJS.mockReturnValue([{ skiaId: 'layer1', jsObjectId: 'obj1', confidence: 0.9 }]);
  });

  describe('detectRenderer', () => {
    it('returns renderer info with auto canvasId', async () => {
      const { detectRenderer } = await import('@server/domains/skia-capture/handlers/skia-detect');
      const result = await detectRenderer(mockPageController, {});
      expect(result).toMatchObject({ canvasId: 'auto', detectionComplete: true });
    });

    it('uses provided canvasId', async () => {
      const { detectRenderer } = await import('@server/domains/skia-capture/handlers/skia-detect');
      const result = await detectRenderer(mockPageController, { canvasId: 'myCanvas' });
      expect(result).toMatchObject({ canvasId: 'myCanvas' });
    });
  });

  describe('dumpScene', () => {
    it('returns scene tree', async () => {
      const { dumpScene } = await import('@server/domains/skia-capture/handlers/skia-detect');
      const result = await dumpScene(mockPageController, {});
      expect(result).toMatchObject({ canvasId: 'auto', extractionComplete: true });
      expect((result as any).sceneTree).toBeDefined();
    });

    it('passes includeDrawCommands=false', async () => {
      const { dumpScene } = await import('@server/domains/skia-capture/handlers/skia-detect');
      await dumpScene(mockPageController, { includeDrawCommands: false });
      expect(mockExtractSceneTree).toHaveBeenCalledWith(mockPageController, undefined, false);
    });
  });

  describe('correlateObjects', () => {
    it('throws when scene is empty', async () => {
      mockExtractSceneTree.mockResolvedValueOnce({ layers: [], drawCommands: [] });
      const { correlateObjects } =
        await import('@server/domains/skia-capture/handlers/skia-detect');
      await expect(correlateObjects(mockPageController, {})).rejects.toThrow(
        'No Skia scene data available',
      );
    });

    it('correlates with JS objects', async () => {
      const { correlateObjects } =
        await import('@server/domains/skia-capture/handlers/skia-detect');
      const getJSObjects = vi.fn().mockResolvedValue([{ id: 'obj1' }]);
      const result = await correlateObjects(mockPageController, {}, getJSObjects);
      expect(result).toMatchObject({ correlationComplete: true });
      expect(getJSObjects).toHaveBeenCalled();
    });

    it('handles getJSObjects error gracefully', async () => {
      const { correlateObjects } =
        await import('@server/domains/skia-capture/handlers/skia-detect');
      const getJSObjects = vi.fn().mockRejectedValue(new Error('no heap'));
      const result = await correlateObjects(mockPageController, {}, getJSObjects);
      expect(result).toMatchObject({ correlationComplete: true });
    });

    it('works without getJSObjects callback', async () => {
      const { correlateObjects } =
        await import('@server/domains/skia-capture/handlers/skia-detect');
      const result = await correlateObjects(mockPageController, {});
      expect(result).toMatchObject({ correlationComplete: true });
    });

    it('filters by skiaNodeIds when provided', async () => {
      const { correlateObjects } =
        await import('@server/domains/skia-capture/handlers/skia-detect');
      const result = await correlateObjects(mockPageController, { skiaNodeIds: ['layer1'] });
      expect(mockCorrelateToJS).toHaveBeenCalled();
      expect(result).toMatchObject({ correlationComplete: true });
    });

    it('uses provided canvasId', async () => {
      const { correlateObjects } =
        await import('@server/domains/skia-capture/handlers/skia-detect');
      const result = await correlateObjects(mockPageController, { canvasId: 'c1' });
      expect(result).toMatchObject({ canvasId: 'c1' });
    });
  });
});
