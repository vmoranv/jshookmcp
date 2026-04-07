/**
 * Type definitions for Skia rendering pipeline analysis.
 *
 * Covers renderer fingerprinting, scene tree extraction,
 * and Skia-to-JS object correlation.
 */

/**
 * GPU backend used by Skia.
 */
export type SkiaGPUBackend = 'gl' | 'vulkan' | 'metal' | 'software';

/**
 * Shader pipeline type detected from the Skia renderer.
 */
export type SkiaShaderPipeline = 'OpenGL' | 'Vulkan' | 'Metal' | 'Raster' | 'unknown';

/**
 * Skia renderer information — version, GPU backend, shader pipeline, features.
 * Fulfills SKIA-01.
 */
export interface SkiaRendererInfo {
  /** Whether the canvas appears to be backed by Skia */
  isSkiaBacked: boolean;
  /** Detected Skia version (may be null if not determinable) */
  version: string | null;
  /** GPU backend: gl, vulkan, metal, or software */
  gpuBackend: SkiaGPUBackend;
  /** Shader pipeline type */
  shaderPipeline: SkiaShaderPipeline;
  /** Detected renderer strings (e.g. "ANGLE (NVIDIA)", "SwiftShader", "Mesa") */
  rendererStrings: string[];
  /** List of Skia-specific features detected */
  features: string[];
  /** Confidence score 0.0–1.0 */
  confidence: number;
  /** Raw detection evidence */
  evidence: string[];
}

/**
 * A layer in the Skia scene tree.
 */
export interface SkiaLayer {
  /** Unique layer identifier */
  id: string;
  /** Layer name or type */
  name: string;
  /** Layer bounds in engine coordinates */
  bounds: { x: number; y: number; width: number; height: number };
  /** 2D transform matrix (flat 9-element array) */
  transform: number[];
  /** Layer opacity 0–1 */
  opacity: number;
  /** Whether the layer is visible */
  visible: boolean;
  /** Child layers */
  children: SkiaLayer[];
  /** Additional metadata */
  customData?: Record<string, unknown>;
}

/**
 * A single draw command extracted from the canvas context.
 */
export interface SkiaDrawCommand {
  /** Command type */
  type:
    | 'drawRect'
    | 'drawText'
    | 'drawImage'
    | 'drawPath'
    | 'drawCircle'
    | 'drawLine'
    | 'drawRRect'
    | 'unknown';
  /** Bounds of the drawn element */
  bounds: { x: number; y: number; width: number; height: number };
  /** Paint information (color, stroke, etc.) */
  paintInfo: Record<string, unknown>;
  /** Optional associated layer ID */
  layerId?: string;
}

/**
 * Complete Skia scene tree.
 * Fulfills SKIA-02.
 */
export interface SkiaSceneTree {
  /** Root layer */
  rootLayer: SkiaLayer | null;
  /** All layers (flattened) */
  layers: SkiaLayer[];
  /** Extracted draw commands */
  drawCommands: SkiaDrawCommand[];
  /** Total layer count */
  totalLayers: number;
  /** Total draw command count */
  totalDrawCommands: number;
  /** Canvas metadata */
  canvas: {
    id?: string;
    width: number;
    height: number;
    dpr: number;
    contextType: string;
  };
}

/**
 * Raw canvas fingerprint data with Skia detection metadata.
 */
export interface SkiaFingerprint {
  /** The renderer info result */
  rendererInfo: SkiaRendererInfo;
  /** Canvas elements found on the page */
  canvasElements: Array<{
    id: string;
    width: number;
    height: number;
    contextType: string;
  }>;
  /** Timestamp of detection */
  timestamp: number;
}

/**
 * Correlation between a Skia rendering object and a JS heap object.
 * Fulfills SKIA-03.
 */
export interface SkiaJSCorrelation {
  /** Skia draw command or layer ID */
  skiaObjectId: string;
  /** JS object ID (from heap snapshot) */
  jsObjectId: string;
  /** JS object name/path */
  jsObjectName: string;
  /** Confidence score 0.0–1.0 */
  confidence: number;
  /** Match type used */
  matchType: 'text' | 'dimension' | 'color' | 'url' | 'name' | 'geometry';
  /** Human-readable explanation */
  explanation: string;
}

/**
 * Result of correlating Skia scene objects to JS objects.
 */
export interface CorrelationResult {
  /** Individual correlations */
  correlations: SkiaJSCorrelation[];
  /** JS objects that had no match */
  unmatchedJSObjects: string[];
  /** Skia objects that had no match */
  unmatchedSkiaObjects: string[];
  /** Summary statistics */
  summary: {
    totalSkiaObjects: number;
    totalJSObjects: number;
    matchedCount: number;
    averageConfidence: number;
  };
}
