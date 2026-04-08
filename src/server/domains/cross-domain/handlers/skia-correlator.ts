import type { CrossDomainEvidenceBridge } from './evidence-graph-bridge';

export interface SkiaDrawCommand {
  id: string;
  type: string;
  label: string;
}

export interface SkiaLayer {
  id: string;
  label: string;
  type: string;
  heapObjectId?: string;
}

export interface SkiaSceneTree {
  layers: SkiaLayer[];
  drawCommands: SkiaDrawCommand[];
}

export interface JSObjectDescriptor {
  objectId: string;
  className: string;
  name: string;
  stringProps: string[];
  numericProps: Record<string, number>;
  colorProps: string[];
  urlProps: string[];
}

export interface SkiaCorrelationInput {
  sceneTree: SkiaSceneTree;
  jsObjects: JSObjectDescriptor[];
}

export interface SkiaCorrelation {
  skiaNodeId: string;
  matchedObjectId: string;
  matchedObjectName: string;
  matchScore: number;
}

export interface SkiaCorrelationResult {
  skiaNodes: number;
  correlations: SkiaCorrelation[];
  unmatchedSkiaNodes: string[];
  confidence: number;
  graphNodeIds: string[];
}

function computeTokenSimilarity(a: string, b: string): number {
  const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb && na.length > 0) {
    return 1.0;
  }
  if (na.length === 0 || nb.length === 0) {
    return 0;
  }
  // Check substring containment
  if (na.includes(nb) || nb.includes(na)) {
    return 0.8;
  }
  return 0;
}

function findBestJSMatch(
  label: string,
  jsObjects: JSObjectDescriptor[],
): { objectId: string; name: string; score: number } | undefined {
  let bestScore = 0;
  let bestMatch: { objectId: string; name: string; score: number } | undefined;

  for (const obj of jsObjects) {
    // Check name match
    const nameScore = computeTokenSimilarity(label, obj.name);
    if (nameScore > bestScore) {
      bestScore = nameScore;
      bestMatch = { objectId: obj.objectId, name: obj.name, score: nameScore };
    }

    // Check string props for matches
    for (const prop of obj.stringProps) {
      const propScore = computeTokenSimilarity(label, prop);
      if (propScore > bestScore) {
        bestScore = propScore;
        bestMatch = { objectId: obj.objectId, name: obj.name, score: propScore };
      }
    }
  }

  if (bestMatch && bestScore >= 0.5) {
    return bestMatch;
  }
  return undefined;
}

export function correlateSkiaToJS(
  bridge: CrossDomainEvidenceBridge,
  input: SkiaCorrelationInput,
): SkiaCorrelationResult {
  const graphNodeIds: string[] = [];
  const correlations: SkiaCorrelation[] = [];
  const unmatchedSkiaNodes: string[] = [];
  const matchedIds = new Set<string>();

  const allSkiaItems: Array<{ id: string; label: string; heapObjectId?: string }> = [];

  // Process layers
  for (const layer of input.sceneTree.layers) {
    allSkiaItems.push({ id: layer.id, label: layer.label, heapObjectId: layer.heapObjectId });
  }

  // Process draw commands
  for (const cmd of input.sceneTree.drawCommands) {
    allSkiaItems.push({ id: cmd.id, label: cmd.label });
  }

  const totalSkiaNodes = allSkiaItems.length;

  for (const item of allSkiaItems) {
    const canvasNode = bridge.addCanvasNode({ nodeId: item.id, label: item.label });
    graphNodeIds.push(canvasNode.id);

    // If layer has an explicit heapObjectId, try to match directly
    if (item.heapObjectId) {
      const jsObj = input.jsObjects.find((o) => o.objectId === item.heapObjectId);
      if (jsObj) {
        const heapNode = bridge.addV8Object({ address: item.heapObjectId, name: jsObj.name });
        graphNodeIds.push(heapNode.id);
        bridge.getGraph().addEdge(heapNode.id, canvasNode.id, 'canvas-rendered-by', {
          domain: 'cross-domain',
          matchScore: 1.0,
        });
        correlations.push({
          skiaNodeId: item.id,
          matchedObjectId: jsObj.objectId,
          matchedObjectName: jsObj.name,
          matchScore: 1.0,
        });
        matchedIds.add(item.id);
        continue;
      }
    }

    // Token-similarity matching
    const match = findBestJSMatch(item.label, input.jsObjects);
    if (match) {
      const heapNode = bridge.addV8Object({ address: match.objectId, name: match.name });
      graphNodeIds.push(heapNode.id);
      bridge.getGraph().addEdge(heapNode.id, canvasNode.id, 'canvas-rendered-by', {
        domain: 'cross-domain',
        matchScore: match.score,
      });
      correlations.push({
        skiaNodeId: item.id,
        matchedObjectId: match.objectId,
        matchedObjectName: match.name,
        matchScore: match.score,
      });
      matchedIds.add(item.id);
    } else {
      unmatchedSkiaNodes.push(item.id);
    }
  }

  const confidence = totalSkiaNodes === 0 ? 0 : correlations.length / totalSkiaNodes;

  return {
    skiaNodes: totalSkiaNodes,
    correlations,
    unmatchedSkiaNodes,
    confidence,
    graphNodeIds,
  };
}
