/**
 * Skia-to-JS Object Correlator.
 *
 * Fulfills SKIA-03: correlates Skia rendering objects back to JS scene graph objects
 * using text matching, dimension matching, color matching, and geometry heuristics.
 */
import type { SkiaSceneTree, CorrelationResult, SkiaJSCorrelation } from './types';

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

    if (bestMatch && bestMatch.confidence >= 0.3) {
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

/**
 * Try to match a single Skia object with a JS object.
 */
function tryMatch(
  skiaObj: {
    id: string;
    type: string;
    name: string;
    text?: string;
    bounds: { x: number; y: number; width: number; height: number };
    color?: string;
  },
  jsObj: JSObjectInfo,
): SkiaJSCorrelation | null {
  // Text match
  if (skiaObj.text) {
    for (const str of jsObj.stringProps) {
      if (str === skiaObj.text || (str.includes(skiaObj.text) && skiaObj.text.length > 3)) {
        return {
          skiaObjectId: skiaObj.id,
          jsObjectId: jsObj.objectId,
          jsObjectName: jsObj.name || jsObj.className,
          confidence: 0.85,
          matchType: 'text',
          explanation: `Draw text "${skiaObj.text.slice(0, 50)}" matches JS string property`,
        };
      }
    }
  }

  // Dimension match
  const dimMatch = matchDimensions(skiaObj.bounds, jsObj.numericProps);
  if (dimMatch) {
    return {
      skiaObjectId: skiaObj.id,
      jsObjectId: jsObj.objectId,
      jsObjectName: jsObj.name || jsObj.className,
      confidence: dimMatch.confidence,
      matchType: 'dimension',
      explanation: dimMatch.explanation,
    };
  }

  // Color match
  if (skiaObj.color) {
    for (const color of jsObj.colorProps) {
      if (colorsMatch(color, skiaObj.color)) {
        return {
          skiaObjectId: skiaObj.id,
          jsObjectId: jsObj.objectId,
          jsObjectName: jsObj.name || jsObj.className,
          confidence: 0.7,
          matchType: 'color',
          explanation: `Color ${skiaObj.color} matches JS color property "${color}"`,
        };
      }
    }
  }

  // URL match (for image draw commands)
  if (skiaObj.type === 'drawImage') {
    const urlFromPaint = skiaObj.color; // stored in color field for images
    if (urlFromPaint) {
      for (const url of jsObj.urlProps) {
        if (url === urlFromPaint || url.includes(urlFromPaint)) {
          return {
            skiaObjectId: skiaObj.id,
            jsObjectId: jsObj.objectId,
            jsObjectName: jsObj.name || jsObj.className,
            confidence: 0.8,
            matchType: 'url',
            explanation: `Image URL matches JS property`,
          };
        }
      }
    }
  }

  // Name match
  if (skiaObj.name) {
    if (jsObj.name && namesMatch(skiaObj.name, jsObj.name)) {
      return {
        skiaObjectId: skiaObj.id,
        jsObjectId: jsObj.objectId,
        jsObjectName: jsObj.name,
        confidence: 0.75,
        matchType: 'name',
        explanation: `Object name "${skiaObj.name}" matches JS object "${jsObj.name}"`,
      };
    }
    for (const str of jsObj.stringProps) {
      if (namesMatch(skiaObj.name, str)) {
        return {
          skiaObjectId: skiaObj.id,
          jsObjectId: jsObj.objectId,
          jsObjectName: jsObj.name || jsObj.className,
          confidence: 0.6,
          matchType: 'name',
          explanation: `Skia layer name matches JS string property`,
        };
      }
    }
  }

  // Geometry match (bounds overlap with numeric position props)
  const geoMatch = matchGeometry(skiaObj.bounds, jsObj.numericProps);
  if (geoMatch) {
    return {
      skiaObjectId: skiaObj.id,
      jsObjectId: jsObj.objectId,
      jsObjectName: jsObj.name || jsObj.className,
      confidence: geoMatch.confidence,
      matchType: 'geometry',
      explanation: geoMatch.explanation,
    };
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
  const tolerance = 2; // pixel tolerance

  for (const key of dimKeys) {
    const val = props[key];
    if (val === undefined) continue;
    if (key === 'width' || key === 'w' || key === 'sizeX' || key === 'sw') {
      if (Math.abs(val - bounds.width) <= tolerance) matchedWidth = true;
    }
    if (key === 'height' || key === 'h' || key === 'sizeY' || key === 'sh') {
      if (Math.abs(val - bounds.height) <= tolerance) matchedHeight = true;
    }
  }

  if (matchedWidth && matchedHeight) {
    return {
      confidence: 0.75,
      explanation: `Dimensions ${bounds.width}x${bounds.height} match JS numeric properties`,
    };
  }
  if (matchedWidth || matchedHeight) {
    return {
      confidence: 0.45,
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
  const tolerance = 5;

  for (const [key, val] of Object.entries(props)) {
    if (key === 'x' || key === 'posX' || key === 'left') {
      if (Math.abs(val - bounds.x) <= tolerance) matchedX = true;
    }
    if (key === 'y' || key === 'posY' || key === 'top') {
      if (Math.abs(val - bounds.y) <= tolerance) matchedY = true;
    }
  }

  if (matchedX && matchedY) {
    return {
      confidence: 0.5,
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
