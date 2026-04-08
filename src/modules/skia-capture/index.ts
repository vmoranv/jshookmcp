export { SkiaSceneExtractor, detectSkiaRenderer, extractSceneTree } from './SkiaSceneExtractor';
export type { Rect, SceneNode, SceneTree, SkiaRendererInfo } from './SkiaSceneExtractor';

export { correlateToJS } from './SkiaObjectCorrelator';
export type { JSObjectInfo } from './SkiaObjectCorrelator';

export type {
  SkiaGPUBackend,
  SkiaShaderPipeline,
  SkiaRendererInfo as SkiaRendererInfoLegacy,
  SkiaLayer,
  SkiaDrawCommand,
  SkiaSceneTree,
  SkiaFingerprint,
  SkiaJSCorrelation,
  CorrelationResult,
} from './types';
