/**
 * canvas_scene_search — search a previously-dumped scene tree for nodes
 * matching a name / type / property / bounds query.
 *
 * Pure-compute: takes the JSON output of canvas_scene_dump (or any scene tree
 * shaped like { name, type, children }) and walks it without a browser. Useful
 * for locating specific game objects across a large dumped tree without
 * re-running the browser-side extraction.
 */

import type { ToolResponse } from '@server/types';
import { asJsonResponse } from '@server/domains/shared/response';

interface SceneNode {
  name?: unknown;
  type?: unknown;
  id?: unknown;
  children?: unknown;
  [key: string]: unknown;
}

type PropertyOp = 'eq' | 'contains' | 'gt' | 'lt';

interface PropertyFilter {
  key: string;
  op: PropertyOp;
  value: unknown;
}

interface BoundsFilter {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SearchMatch {
  name: string;
  type: string;
  path: string[];
  depth: number;
  id?: string;
  properties: Record<string, unknown>;
}

interface SceneSearchResult {
  success: boolean;
  error?: string;
  matchedCount: number;
  truncated: boolean;
  matches: SearchMatch[];
  nodesScanned: number;
}

const META_KEYS = new Set([
  'name',
  'type',
  'id',
  'children',
  'parent',
  'x',
  'y',
  'width',
  'height',
]);

const VALID_OPS = new Set<PropertyOp>(['eq', 'contains', 'gt', 'lt']);

function asString(value: unknown): string {
  return typeof value === 'string'
    ? value
    : value === undefined || value === null
      ? ''
      : String(value);
}

function isSceneNode(value: unknown): value is SceneNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Normalize the dumped JSON into a list of root nodes to walk. */
function collectRoots(tree: unknown): SceneNode[] {
  if (Array.isArray(tree)) {
    return tree.filter(isSceneNode);
  }
  if (!isSceneNode(tree)) {
    return [];
  }
  // If the object already looks like a scene node (has name/type), treat as bare root.
  if (tree.name !== undefined || tree.type !== undefined) {
    return [tree];
  }
  // Otherwise unwrap a common wrapper key (root/tree/scene/nodes/children).
  for (const key of ['root', 'tree', 'scene', 'nodes', 'children']) {
    const inner = tree[key];
    if (isSceneNode(inner)) {
      return [inner];
    }
    if (Array.isArray(inner)) {
      const filtered = inner.filter(isSceneNode);
      if (filtered.length > 0) return filtered;
    }
  }
  return [];
}

function buildProperties(node: SceneNode): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (!META_KEYS.has(key)) {
      props[key] = value;
    }
  }
  return props;
}

function parsePropertyFilter(raw: unknown): PropertyFilter | null | { error: string } {
  if (raw === undefined || raw === null) return null;
  if (!isSceneNode(raw)) {
    return { error: 'propertyFilter must be an object' };
  }
  const key = raw.key;
  const op = raw.op;
  const value = raw.value;
  if (typeof key !== 'string' || key.length === 0) {
    return { error: 'propertyFilter.key must be a non-empty string' };
  }
  if (typeof op !== 'string' || !VALID_OPS.has(op as PropertyOp)) {
    return { error: `propertyFilter.op must be one of: ${[...VALID_OPS].join(', ')}` };
  }
  if (value === undefined) {
    return { error: 'propertyFilter.value is required' };
  }
  return { key, op: op as PropertyOp, value };
}

function matchProperty(node: SceneNode, filter: PropertyFilter): boolean {
  // Look at the raw node so meta keys (x/y/width/height) are queryable too.
  const candidate = node[filter.key];
  if (candidate === undefined) return false;
  if (filter.op === 'eq') {
    return candidate === filter.value || String(candidate) === String(filter.value);
  }
  if (filter.op === 'contains') {
    return String(candidate).includes(String(filter.value));
  }
  const num = Number(candidate);
  const target = Number(filter.value);
  if (!Number.isFinite(num) || !Number.isFinite(target)) return false;
  return filter.op === 'gt' ? num > target : num < target;
}

function parseBounds(raw: unknown): BoundsFilter | null | { error: string } {
  if (raw === undefined || raw === null) return null;
  if (!isSceneNode(raw)) {
    return { error: 'bounds must be an object' };
  }
  const x = raw.x;
  const y = raw.y;
  const width = raw.width;
  const height = raw.height;
  if (![x, y, width, height].every((v) => typeof v === 'number' && Number.isFinite(v))) {
    return { error: 'bounds requires numeric x, y, width, height' };
  }
  return {
    x: x as number,
    y: y as number,
    width: width as number,
    height: height as number,
  };
}

function getNumeric(node: SceneNode, key: string): number | undefined {
  const v = node[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function matchBounds(node: SceneNode, bounds: BoundsFilter): boolean {
  const nx = getNumeric(node, 'x');
  const ny = getNumeric(node, 'y');
  const nw = getNumeric(node, 'width');
  const nh = getNumeric(node, 'height');
  if (nx === undefined || ny === undefined || nw === undefined || nh === undefined) {
    return false;
  }
  // Axis-aligned rectangle intersection.
  return (
    nx < bounds.x + bounds.width &&
    nx + nw > bounds.x &&
    ny < bounds.y + bounds.height &&
    ny + nh > bounds.y
  );
}

export async function handleSceneSearch(args: Record<string, unknown>): Promise<ToolResponse> {
  const tree = args['sceneTree'];
  if (tree === undefined || tree === null) {
    return asJsonResponse({
      success: false,
      error: 'sceneTree is required (pass the output of canvas_scene_dump)',
    });
  }

  const namePattern = typeof args['namePattern'] === 'string' ? args['namePattern'] : undefined;
  const typeFilter = typeof args['typeFilter'] === 'string' ? args['typeFilter'] : undefined;
  const maxResults =
    typeof args['maxResults'] === 'number' && args['maxResults'] > 0 ? args['maxResults'] : 100;

  const propertyFilterRaw = parsePropertyFilter(args['propertyFilter']);
  if (propertyFilterRaw && 'error' in propertyFilterRaw) {
    return asJsonResponse({ success: false, error: propertyFilterRaw.error });
  }
  const propertyFilter = propertyFilterRaw as PropertyFilter | null;

  const boundsRaw = parseBounds(args['bounds']);
  if (boundsRaw && 'error' in boundsRaw) {
    return asJsonResponse({ success: false, error: boundsRaw.error });
  }
  const bounds = boundsRaw as BoundsFilter | null;

  let nameRegex: RegExp | undefined;
  if (namePattern) {
    try {
      nameRegex = new RegExp(namePattern, 'i');
    } catch {
      return asJsonResponse({
        success: false,
        error: `Invalid namePattern regex: ${namePattern}`,
      });
    }
  }

  const roots = collectRoots(tree);
  if (roots.length === 0) {
    return asJsonResponse({
      success: false,
      error: 'sceneTree did not contain any recognizable scene nodes',
    });
  }

  const matches: SearchMatch[] = [];
  let nodesScanned = 0;

  const walk = (node: SceneNode, path: string[], depth: number): void => {
    nodesScanned++;
    const name = asString(node.name);
    const type = asString(node.type);

    const nameMatch = !nameRegex || nameRegex.test(name);
    const typeMatch = !typeFilter || type.toLowerCase() === typeFilter.toLowerCase();
    const propMatch = !propertyFilter || matchProperty(node, propertyFilter);
    const boundsMatch = !bounds || matchBounds(node, bounds);
    const hasAnyFilter = Boolean(nameRegex || typeFilter || propertyFilter || bounds);
    if (nameMatch && typeMatch && propMatch && boundsMatch && hasAnyFilter) {
      matches.push({
        name,
        type,
        path: [...path, name || type || '<anonymous>'],
        depth,
        ...(typeof node.id === 'string' || typeof node.id === 'number'
          ? { id: String(node.id) }
          : {}),
        properties: buildProperties(node),
      });
    }

    if (Array.isArray(node.children)) {
      const childPath = [...path, name || type || '<anonymous>'];
      for (const child of node.children) {
        if (isSceneNode(child)) {
          walk(child, childPath, depth + 1);
        }
      }
    }
  };

  for (const root of roots) {
    walk(root, [], 0);
    if (matches.length >= maxResults) break;
  }

  const truncated = matches.length > maxResults;
  const capped = matches.slice(0, maxResults);

  const result: SceneSearchResult = {
    success: true,
    matchedCount: matches.length,
    truncated,
    matches: capped,
    nodesScanned,
  };
  return asJsonResponse(result);
}
