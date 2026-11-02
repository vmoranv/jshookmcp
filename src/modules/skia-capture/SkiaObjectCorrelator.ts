/**
 * Skia-to-JS Object Correlator.
 *
 * Fulfills SKIA-03: correlates Skia rendering objects back to JS scene graph objects
 * using text matching, dimension matching, color matching, and geometry heuristics.
 */
import type { SkiaSceneTree, CorrelationResult, SkiaJSCorrelation } from './types';

// ── Correlation scoring constants ──────────────────────────────────────────────
// Confidence values rate how strongly a matched heuristic implies the same JS
// object; the acceptance threshold filters out weak noise matches. Tolerances
// are pixel slack for dimension/position comparisons.

/** Minimum confidence for a correlation to be kept in the result. */
const MIN_ACCEPTED_CONFIDENCE = 0.3;
/** Confidence for exact/embedded text-string matches. */
const TEXT_MATCH_CONFIDENCE = 0.85;
/** Minimum text length before an embedded string counts as a text match. */
const MIN_TEXT_MATCH_CHARS = 3;
/** Explanation message preview length. */
const EXPLANATION_TRUNCATE_CHARS = 50;
/** Confidence for identical color matches. */
const COLOR_MATCH_CONFIDENCE = 0.7;
/** Confidence for drawImage URL matches. */
const URL_MATCH_CONFIDENCE = 0.8;
/** Confidence for object-name equality matches. */
const NAME_MATCH_CONFIDENCE = 0.75;
/** Confidence for layer-name-to-string-property matches. */
const NAME_STRING_MATCH_CONFIDENCE = 0.6;
/** Confidence for full width+height dimension matches. */
const DIMENSION_MATCH_CONFIDENCE = 0.75;
/** Confidence for partial (single-axis) dimension matches. */
const PARTIAL_DIMENSION_MATCH_CONFIDENCE = 0.45;
/** Pixel tolerance for dimension equality. */
const DIMENSION_TOLERANCE_PX = 2;
/** Confidence for x/y position matches. */
const GEOMETRY_MATCH_CONFIDENCE = 0.5;
/** Pixel tolerance for position equality. */
const GEOMETRY_TOLERANCE_PX = 5;

/**
 * Minimal JS object info from v8-inspector heap snapshot.
 */
export interface JSObjectInfo {
  /** Object ID from heap snapshot */
  objectId: string;
  /** Object class/name */
  className: string;
  /** Object name/key if available */
  name?: string;
  /** String properties extracted from the object */
  stringProps: string[];
  /** Numeric properties (dimensions, positions) */
  numericProps: Record<string, number>;
  /** Color values found in the object */
  colorProps: string[];
  /** URL values found in the object */
  urlProps: string[];
}

/**
 * Correlate Skia scene tree with JS objects from heap snapshot.
 */
export function correlateToJS(
  sceneTree: SkiaSceneTree,
  jsObjects: JSObjectInfo[],
): CorrelationResult {
  const correlations: SkiaJSCorrelation[] = [];
  const matchedSkiaIds = new Set<string>();
  const matchedJSIds = new Set<string>();

  // Collect all correlatable Skia objects (layers + draw commands)
  const skiaObjects = collectSkiaObjects(sceneTree);

  for (const skiaObj of skiaObjects) {
    let bestMatch: SkiaJSCorrelation | null = null;

    for (const jsObj of jsObjects) {
      const correlation = tryMatch(skiaObj, jsObj);
      if (correlation && (!bestMatch || correlation.confidence > bestMatch.confidence)) {
        bestMatch = correlation;
      }
    }

    if (bestMatch && bestMatch.confidence >= MIN_ACCEPTED_CONFIDENCE) {
      correlations.push(bestMatch);
      matchedSkiaIds.add(bestMatch.skiaObjectId);
      matchedJSIds.add(bestMatch.jsObjectId);
    }
  }

  const allSkiaIds = new Set(skiaObjects.map((s) => s.id));
  const unmatchedSkia = [...allSkiaIds].filter((id) => !matchedSkiaIds.has(id));
  const unmatchedJS = jsObjects.filter((o) => !matchedJSIds.has(o.objectId)).map((o) => o.objectId);

  const totalConfidence = correlations.reduce((sum, c) => sum + c.confidence, 0);
  const avgConfidence = correlations.length > 0 ? totalConfidence / correlations.length : 0;

  return {
    correlations,
    unmatchedJSObjects: unmatchedJS,
    unmatchedSkiaObjects: unmatchedSkia,
    summary: {
      totalSkiaObjects: skiaObjects.length,
      totalJSObjects: jsObjects.length,
      matchedCount: correlations.length,
      averageConfidence: Math.round(avgConfidence * 100) / 100,
    },
  };
}

/** The Skia-side object `tryMatch` inspects. */
interface SkiaMatchCandidate {
  id: string;
  type: string;
  name: string;
  text?: string;
  bounds: { x: number; y: number; width: number; height: number };
  color?: string;
}

/** Build a correlation result for a matched pair. */
function correlationOf(
  skiaObj: SkiaMatchCandidate,
  jsObj: JSObjectInfo,
  confidence: number,
  matchType: SkiaJSCorrelation['matchType'],
  explanation: string,
): SkiaJSCorrelation {
  return {
    skiaObjectId: skiaObj.id,
    jsObjectId: jsObj.objectId,
    jsObjectName: jsObj.name || jsObj.className,
    confidence,
    matchType,
    explanation,
  };
}

/** Text strategy: the drawn string equals or is contained in a JS string. */
function matchByText(skiaObj: SkiaMatchCandidate, jsObj: JSObjectInfo): SkiaJSCorrelation | null {
  if (!skiaObj.text) return null;
  for (const str of jsObj.stringProps) {
    if (
      str === skiaObj.text ||
      (str.includes(skiaObj.text) && skiaObj.text.length > MIN_TEXT_MATCH_CHARS)
    ) {
      return correlationOf(
        skiaObj,
        jsObj,
        TEXT_MATCH_CONFIDENCE,
        'text',
        `Draw text "${skiaObj.text.slice(0, EXPLANATION_TRUNCATE_CHARS)}" matches JS string property`,
      );
    }
  }
  return null;
}

/** Dimension strategy: bounds dimensions line up with numeric props. */
function matchByDimension(
  skiaObj: SkiaMatchCandidate,
  jsObj: JSObjectInfo,
): SkiaJSCorrelation | null {
  const dimMatch = matchDimensions(skiaObj.bounds, jsObj.numericProps);
  if (!dimMatch) return null;
  return correlationOf(skiaObj, jsObj, dimMatch.confidence, 'dimension', dimMatch.explanation);
}

/** Colour strategy: the draw colour matches a JS colour property. */
function matchByColor(skiaObj: SkiaMatchCandidate, jsObj: JSObjectInfo): SkiaJSCorrelation | null {
  if (!skiaObj.color) return null;
  for (const color of jsObj.colorProps) {
    if (colorsMatch(color, skiaObj.color)) {
      return correlationOf(
        skiaObj,
        jsObj,
        COLOR_MATCH_CONFIDENCE,
        'color',
        `Color ${skiaObj.color} matches JS color property "${color}"`,
      );
    }
  }
  return null;
}

/**
 * URL strategy, for `drawImage` only.
 *
 * Image commands stash their source URL in the `color` field (see the comment
 * in the original body), which is why this reads `skiaObj.color`.
 */
function matchByUrl(skiaObj: SkiaMatchCandidate, jsObj: JSObjectInfo): SkiaJSCorrelation | null {
  if (skiaObj.type !== 'drawImage') return null;
  const urlFromPaint = skiaObj.color;
  if (!urlFromPaint) return null;
  for (const url of jsObj.urlProps) {
    if (url === urlFromPaint || url.includes(urlFromPaint)) {
      return correlationOf(
        skiaObj,
        jsObj,
        URL_MATCH_CONFIDENCE,
        'url',
        `Image URL matches JS property`,
      );
    }
  }
  return null;
}

/**
 * Name strategy: the object's own name, else any JS string property.
 *
 * The two hits use different confidences and different `jsObjectName` sources —
 * a name-to-name hit keeps `jsObj.name`, a name-to-string hit falls back to
 * `className`.
 */
function matchByName(skiaObj: SkiaMatchCandidate, jsObj: JSObjectInfo): SkiaJSCorrelation | null {
  if (!skiaObj.name) return null;

  if (jsObj.name && namesMatch(skiaObj.name, jsObj.name)) {
    return {
      skiaObjectId: skiaObj.id,
      jsObjectId: jsObj.objectId,
      jsObjectName: jsObj.name,
      confidence: NAME_MATCH_CONFIDENCE,
      matchType: 'name',
      explanation: `Object name "${skiaObj.name}" matches JS object "${jsObj.name}"`,
    };
  }
  for (const str of jsObj.stringProps) {
    if (namesMatch(skiaObj.name, str)) {
      return correlationOf(
        skiaObj,
        jsObj,
        NAME_STRING_MATCH_CONFIDENCE,
        'name',
        `Skia layer name matches JS string property`,
      );
    }
  }
  return null;
}

/** Geometry strategy: bounds overlap numeric position props. */
function matchByGeometry(
  skiaObj: SkiaMatchCandidate,
  jsObj: JSObjectInfo,
): SkiaJSCorrelation | null {
  const geoMatch = matchGeometry(skiaObj.bounds, jsObj.numericProps);
  if (!geoMatch) return null;
  return correlationOf(skiaObj, jsObj, geoMatch.confidence, 'geometry', geoMatch.explanation);
}

/**
 * Try to match a single Skia object with a JS object.
 *
 * Strategies are tried in this order and the first hit wins — the order is the
 * confidence contract, so a text hit always beats a dimension hit for the same
 * pair. Reordering this list changes which matchType callers see.
 */
function tryMatch(skiaObj: SkiaMatchCandidate, jsObj: JSObjectInfo): SkiaJSCorrelation | null {
  const strategies = [
    matchByText,
    matchByDimension,
    matchByColor,
    matchByUrl,
    matchByName,
    matchByGeometry,
  ];
  for (const strategy of strategies) {
    const hit = strategy(skiaObj, jsObj);
    if (hit) return hit;
  }
  return null;
}

/**
 * Collect all correlatable objects from a Skia scene tree.
 */
function collectSkiaObjects(sceneTree: SkiaSceneTree): Array<{
  id: string;
  type: string;
  name: string;
  text?: string;
  bounds: { x: number; y: number; width: number; height: number };
  color?: string;
}> {
  const objects: ReturnType<typeof collectSkiaObjects> = [];

  // From layers
  for (const layer of sceneTree.layers) {
    objects.push({
      id: layer.id,
      type: 'layer',
      name: layer.name,
      bounds: layer.bounds,
      color: layer.customData?.color as string | undefined,
    });
  }

  // From draw commands
  for (const cmd of sceneTree.drawCommands) {
    const text = extractTextFromPaint(cmd.paintInfo);
    const color = extractColorFromPaint(cmd.paintInfo);

    objects.push({
      id: `cmd_${cmd.type}_${cmd.bounds.x}_${cmd.bounds.y}`,
      type: cmd.type,
      name: `${cmd.type} at (${cmd.bounds.x}, ${cmd.bounds.y})`,
      text,
      bounds: cmd.bounds,
      color,
    });
  }

  return objects;
}

/**
 * Extract text content from paint info.
 */
function extractTextFromPaint(paintInfo: Record<string, unknown>): string | undefined {
  if (typeof paintInfo.text === 'string') return paintInfo.text;
  if (typeof paintInfo.content === 'string') return paintInfo.content;
  return undefined;
}

/**
 * Extract color from paint info.
 */
function extractColorFromPaint(paintInfo: Record<string, unknown>): string | undefined {
  if (typeof paintInfo.color === 'string') return paintInfo.color;
  if (typeof paintInfo.fillColor === 'string') return paintInfo.fillColor;
  if (typeof paintInfo.strokeColor === 'string') return paintInfo.strokeColor;
  if (typeof paintInfo.url === 'string') return paintInfo.url;
  if (typeof paintInfo.src === 'string') return paintInfo.src;
  return undefined;
}

/**
 * Match dimensions between Skia bounds and JS numeric properties.
 */
function matchDimensions(
  bounds: { width: number; height: number },
  props: Record<string, number>,
): { confidence: number; explanation: string } | null {
  const dimKeys = ['width', 'height', 'w', 'h', 'sizeX', 'sizeY', 'sw', 'sh'];
  let matchedWidth = false;
  let matchedHeight = false;

  for (const key of dimKeys) {
    const val = props[key];
    if (val === undefined) continue;
    if (key === 'width' || key === 'w' || key === 'sizeX' || key === 'sw') {
      if (Math.abs(val - bounds.width) <= DIMENSION_TOLERANCE_PX) matchedWidth = true;
    }
    if (key === 'height' || key === 'h' || key === 'sizeY' || key === 'sh') {
      if (Math.abs(val - bounds.height) <= DIMENSION_TOLERANCE_PX) matchedHeight = true;
    }
  }

  if (matchedWidth && matchedHeight) {
    return {
      confidence: DIMENSION_MATCH_CONFIDENCE,
      explanation: `Dimensions ${bounds.width}x${bounds.height} match JS numeric properties`,
    };
  }
  if (matchedWidth || matchedHeight) {
    return {
      confidence: PARTIAL_DIMENSION_MATCH_CONFIDENCE,
      explanation: `Partial dimension match for ${bounds.width}x${bounds.height}`,
    };
  }

  return null;
}

/**
 * Match geometry (x, y positions) with JS numeric properties.
 */
function matchGeometry(
  bounds: { x: number; y: number },
  props: Record<string, number>,
): { confidence: number; explanation: string } | null {
  let matchedX = false;
  let matchedY = false;

  for (const [key, val] of Object.entries(props)) {
    if (key === 'x' || key === 'posX' || key === 'left') {
      if (Math.abs(val - bounds.x) <= GEOMETRY_TOLERANCE_PX) matchedX = true;
    }
    if (key === 'y' || key === 'posY' || key === 'top') {
      if (Math.abs(val - bounds.y) <= GEOMETRY_TOLERANCE_PX) matchedY = true;
    }
  }

  if (matchedX && matchedY) {
    return {
      confidence: GEOMETRY_MATCH_CONFIDENCE,
      explanation: `Position (${bounds.x}, ${bounds.y}) matches JS numeric properties`,
    };
  }

  return null;
}

/**
 * Simple name matching with case-insensitive comparison.
 */
function namesMatch(a: string, b: string): boolean {
  return (
    a.toLowerCase() === b.toLowerCase() ||
    a.toLowerCase().includes(b.toLowerCase()) ||
    b.toLowerCase().includes(a.toLowerCase())
  );
}

/**
 * Normalize and compare color strings.
 */
function colorsMatch(a: string, b: string): boolean {
  return a.toLowerCase().replace(/\s/g, '') === b.toLowerCase().replace(/\s/g, '');
}
