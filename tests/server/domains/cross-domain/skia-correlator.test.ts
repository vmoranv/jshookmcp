import { describe, expect, it, beforeEach } from 'vitest';
import { correlateSkiaToJS } from '@server/domains/cross-domain/handlers/skia-correlator';
import {
  CrossDomainEvidenceBridge,
  resetIdCounter,
} from '@server/domains/cross-domain/handlers/evidence-graph-bridge';
import {
  ReverseEvidenceGraph,
  resetIdCounter as _resetGraphIdCounter,
} from '@server/evidence/ReverseEvidenceGraph';

describe('SKIA-03: Skia-to-JS Correlator', () => {
  let bridge: CrossDomainEvidenceBridge;

  beforeEach(() => {
    resetIdCounter();
    _resetGraphIdCounter();
    bridge = new CrossDomainEvidenceBridge(new ReverseEvidenceGraph());
  });

  it('should create canvas nodes for draw commands', async () => {
    const result = correlateSkiaToJS(bridge, {
      sceneTree: {
        layers: [],
        drawCommands: [{ id: 'cmd1', type: 'drawRect', label: 'BackgroundRect' }],
      },
      jsObjects: [],
    });

    expect(result.skiaNodes).toBe(1);
    expect(result.unmatchedSkiaNodes).toContain('cmd1');
    expect(result.graphNodeIds.length).toBeGreaterThan(0);
  });

  it('should match draw commands to JS objects by name similarity', async () => {
    const result = correlateSkiaToJS(bridge, {
      sceneTree: {
        layers: [],
        drawCommands: [{ id: 'cmd1', type: 'drawText', label: 'ScoreDisplay' }],
      },
      jsObjects: [
        {
          objectId: 'obj-1',
          className: 'DisplayObject',
          name: 'ScoreDisplay',
          stringProps: ['ScoreDisplay'],
          numericProps: {},
          colorProps: [],
          urlProps: [],
        },
      ],
    });

    expect(result.correlations).toHaveLength(1);
    // @ts-expect-error
    expect(result.correlations[0].matchedObjectName).toBe('ScoreDisplay');
    expect(result.confidence).toBe(1);
    expect(result.unmatchedSkiaNodes).toHaveLength(0);
  });

  it('should create canvas-rendered-by edges for matched objects', async () => {
    correlateSkiaToJS(bridge, {
      sceneTree: {
        layers: [],
        drawCommands: [{ id: 'cmd1', type: 'drawText', label: 'HealthBar' }],
      },
      jsObjects: [
        {
          objectId: 'obj-2',
          className: 'Sprite',
          name: 'HealthBar',
          stringProps: ['HealthBar'],
          numericProps: { width: 200, height: 20 },
          colorProps: [],
          urlProps: [],
        },
      ],
    });

    const edges = bridge.getGraph().exportJson().edges;
    const renderedByEdges = edges.filter((e) => e.type === 'canvas-rendered-by');
    expect(renderedByEdges.length).toBeGreaterThan(0);
  });

  it('should handle empty scene tree gracefully', async () => {
    const result = correlateSkiaToJS(bridge, {
      sceneTree: { layers: [], drawCommands: [] },
      jsObjects: [],
    });

    expect(result.skiaNodes).toBe(0);
    expect(result.confidence).toBe(0);
    expect(result.correlations).toHaveLength(0);
  });

  it('should process layers with heapObjectId', async () => {
    const result = correlateSkiaToJS(bridge, {
      sceneTree: {
        layers: [{ id: 'layer1', label: 'GameLayer', type: 'container', heapObjectId: 'obj-x' }],
        drawCommands: [],
      },
      jsObjects: [
        {
          objectId: 'obj-x',
          className: 'Container',
          name: 'GameLayer',
          stringProps: [],
          numericProps: {},
          colorProps: [],
          urlProps: [],
        },
      ],
    });

    expect(result.skiaNodes).toBe(1);
    // Layer with matching heapObjectId should link to heap object
    expect(result.graphNodeIds.length).toBeGreaterThanOrEqual(2);
  });
});
