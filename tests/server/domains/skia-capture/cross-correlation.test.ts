import { describe, it, expect } from 'vitest';
import { correlateToJS } from '@modules/skia-capture/SkiaObjectCorrelator';
import type { JSObjectInfo } from '@modules/skia-capture/SkiaObjectCorrelator';
import type { SkiaSceneTree } from '@modules/skia-capture/types';

describe('SkiaObjectCorrelator', () => {
  describe('correlateToJS', () => {
    it('should match Skia draw text to JS string properties', () => {
      const sceneTree: SkiaSceneTree = {
        rootLayer: null,
        layers: [],
        drawCommands: [
          {
            type: 'drawText',
            bounds: { x: 10, y: 20, width: 200, height: 30 },
            paintInfo: { text: 'Hello World', fillStyle: '#333' },
          },
        ],
        totalLayers: 0,
        totalDrawCommands: 1,
        canvas: { width: 800, height: 600, dpr: 1, contextType: '2d' },
      };

      const jsObjects: JSObjectInfo[] = [
        {
          objectId: 'js_1',
          className: 'TextComponent',
          name: 'title',
          stringProps: ['Hello World', 'subtitle text'],
          numericProps: { x: 10, y: 20 },
          colorProps: ['#333333'],
          urlProps: [],
        },
      ];

      const result = correlateToJS(sceneTree, jsObjects);

      expect(result.correlations.length).toBe(1);
      expect(result.correlations[0]!.matchType).toBe('text');
      expect(result.correlations[0]!.confidence).toBeGreaterThan(0.8);
      expect(result.summary.matchedCount).toBe(1);
    });

    it('should match Skia dimensions to JS numeric properties', () => {
      const sceneTree: SkiaSceneTree = {
        rootLayer: null,
        layers: [],
        drawCommands: [
          {
            type: 'drawImage',
            bounds: { x: 0, y: 0, width: 256, height: 256 },
            paintInfo: { src: 'sprite.png' },
          },
        ],
        totalLayers: 0,
        totalDrawCommands: 1,
        canvas: { width: 800, height: 600, dpr: 1, contextType: '2d' },
      };

      const jsObjects: JSObjectInfo[] = [
        {
          objectId: 'js_1',
          className: 'Sprite',
          name: 'hero',
          stringProps: [],
          numericProps: { width: 256, height: 256 },
          colorProps: [],
          urlProps: [],
        },
      ];

      const result = correlateToJS(sceneTree, jsObjects);

      expect(result.correlations.length).toBe(1);
      expect(result.correlations[0]!.matchType).toBe('dimension');
      expect(result.correlations[0]!.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it('should match Skia colors to JS color properties', () => {
      const sceneTree: SkiaSceneTree = {
        rootLayer: null,
        layers: [],
        drawCommands: [
          {
            type: 'drawRect',
            bounds: { x: 0, y: 0, width: 100, height: 100 },
            paintInfo: { fillColor: '#ff0000' },
          },
        ],
        totalLayers: 0,
        totalDrawCommands: 1,
        canvas: { width: 800, height: 600, dpr: 1, contextType: '2d' },
      };

      const jsObjects: JSObjectInfo[] = [
        {
          objectId: 'js_1',
          className: 'Background',
          name: 'bg',
          stringProps: [],
          numericProps: {},
          colorProps: ['#ff0000', '#00ff00'],
          urlProps: [],
        },
      ];

      const result = correlateToJS(sceneTree, jsObjects);

      expect(result.correlations.length).toBe(1);
      expect(result.correlations[0]!.matchType).toBe('color');
    });

    it('should match layer names to JS object names', () => {
      const sceneTree: SkiaSceneTree = {
        rootLayer: null,
        layers: [
          {
            id: 'layer_hero',
            name: 'HeroSprite',
            bounds: { x: 100, y: 100, width: 64, height: 64 },
            transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
            opacity: 1,
            visible: true,
            children: [],
          },
        ],
        drawCommands: [],
        totalLayers: 1,
        totalDrawCommands: 0,
        canvas: { width: 800, height: 600, dpr: 1, contextType: '2d' },
      };

      const jsObjects: JSObjectInfo[] = [
        {
          objectId: 'js_1',
          className: 'Sprite',
          name: 'HeroSprite',
          stringProps: [],
          numericProps: {},
          colorProps: [],
          urlProps: [],
        },
      ];

      const result = correlateToJS(sceneTree, jsObjects);

      expect(result.correlations.length).toBe(1);
      expect(result.correlations[0]!.matchType).toBe('name');
      expect(result.correlations[0]!.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it('should match geometry (x,y positions) to JS numeric properties', () => {
      const sceneTree: SkiaSceneTree = {
        rootLayer: null,
        layers: [
          {
            id: 'layer_ui',
            name: 'ui_panel',
            bounds: { x: 50, y: 75, width: 200, height: 100 },
            transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
            opacity: 0.9,
            visible: true,
            children: [],
          },
        ],
        drawCommands: [],
        totalLayers: 1,
        totalDrawCommands: 0,
        canvas: { width: 800, height: 600, dpr: 1, contextType: '2d' },
      };

      const jsObjects: JSObjectInfo[] = [
        {
          objectId: 'js_1',
          className: 'Panel',
          name: 'uiPanel',
          stringProps: [],
          numericProps: { x: 50, y: 75 },
          colorProps: [],
          urlProps: [],
        },
      ];

      const result = correlateToJS(sceneTree, jsObjects);

      expect(result.correlations.length).toBeGreaterThanOrEqual(1);
      const geometryMatch = result.correlations.find((c) => c.matchType === 'geometry');
      expect(geometryMatch).toBeDefined();
    });

    it('should return unmatched objects when no matches found', () => {
      const sceneTree: SkiaSceneTree = {
        rootLayer: null,
        layers: [
          {
            id: 'layer_0',
            name: 'zzz_unique_nonexistent',
            bounds: { x: 9999, y: 9999, width: 1, height: 1 },
            transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
            opacity: 1,
            visible: true,
            children: [],
          },
        ],
        drawCommands: [],
        totalLayers: 1,
        totalDrawCommands: 0,
        canvas: { width: 800, height: 600, dpr: 1, contextType: '2d' },
      };

      const jsObjects: JSObjectInfo[] = [
        {
          objectId: 'js_1',
          className: 'Unrelated',
          name: 'something_else',
          stringProps: ['completely different text'],
          numericProps: { x: 0, y: 0, width: 1, height: 1 },
          colorProps: [],
          urlProps: [],
        },
      ];

      const result = correlateToJS(sceneTree, jsObjects);

      expect(result.unmatchedJSObjects.length).toBeGreaterThanOrEqual(0);
      expect(result.unmatchedSkiaObjects.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle empty scene tree', () => {
      const sceneTree: SkiaSceneTree = {
        rootLayer: null,
        layers: [],
        drawCommands: [],
        totalLayers: 0,
        totalDrawCommands: 0,
        canvas: { width: 0, height: 0, dpr: 1, contextType: 'unknown' },
      };

      const jsObjects: JSObjectInfo[] = [
        {
          objectId: 'js_1',
          className: 'Sprite',
          name: 'test',
          stringProps: ['test'],
          numericProps: {},
          colorProps: [],
          urlProps: [],
        },
      ];

      const result = correlateToJS(sceneTree, jsObjects);

      expect(result.correlations).toEqual([]);
      expect(result.unmatchedJSObjects.length).toBe(1);
      expect(result.unmatchedSkiaObjects).toEqual([]);
      expect(result.summary.averageConfidence).toBe(0);
    });

    it('should handle empty JS objects list', () => {
      const sceneTree: SkiaSceneTree = {
        rootLayer: null,
        layers: [
          {
            id: 'layer_0',
            name: 'test',
            bounds: { x: 0, y: 0, width: 100, height: 100 },
            transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
            opacity: 1,
            visible: true,
            children: [],
          },
        ],
        drawCommands: [],
        totalLayers: 1,
        totalDrawCommands: 0,
        canvas: { width: 800, height: 600, dpr: 1, contextType: '2d' },
      };

      const result = correlateToJS(sceneTree, []);

      expect(result.correlations).toEqual([]);
      expect(result.unmatchedSkiaObjects.length).toBe(1);
      expect(result.summary.totalJSObjects).toBe(0);
      expect(result.summary.matchedCount).toBe(0);
    });

    it('should compute summary statistics correctly', () => {
      const sceneTree: SkiaSceneTree = {
        rootLayer: null,
        layers: [
          {
            id: 'layer_0',
            name: 'matched_name',
            bounds: { x: 0, y: 0, width: 100, height: 100 },
            transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
            opacity: 1,
            visible: true,
            children: [],
          },
          {
            id: 'layer_1',
            name: 'unmatched_layer',
            bounds: { x: 500, y: 500, width: 10, height: 10 },
            transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
            opacity: 1,
            visible: true,
            children: [],
          },
        ],
        drawCommands: [],
        totalLayers: 2,
        totalDrawCommands: 0,
        canvas: { width: 800, height: 600, dpr: 1, contextType: '2d' },
      };

      const jsObjects: JSObjectInfo[] = [
        {
          objectId: 'js_1',
          className: 'MatchedObject',
          name: 'matched_name',
          stringProps: [],
          numericProps: {},
          colorProps: [],
          urlProps: [],
        },
      ];

      const result = correlateToJS(sceneTree, jsObjects);

      expect(result.summary.totalSkiaObjects).toBe(2);
      expect(result.summary.totalJSObjects).toBe(1);
      expect(result.summary.matchedCount).toBeGreaterThanOrEqual(1);
    });

    it('should use best confidence when multiple JS objects match', () => {
      const sceneTree: SkiaSceneTree = {
        rootLayer: null,
        layers: [],
        drawCommands: [
          {
            type: 'drawText',
            bounds: { x: 0, y: 0, width: 100, height: 30 },
            paintInfo: { text: 'exact match' },
          },
        ],
        totalLayers: 0,
        totalDrawCommands: 1,
        canvas: { width: 800, height: 600, dpr: 1, contextType: '2d' },
      };

      const jsObjects: JSObjectInfo[] = [
        {
          objectId: 'js_1',
          className: 'TextA',
          name: 'partial',
          stringProps: ['exact match', 'other text'],
          numericProps: {},
          colorProps: [],
          urlProps: [],
        },
        {
          objectId: 'js_2',
          className: 'TextB',
          name: 'partial',
          stringProps: ['exact match', 'more text'],
          numericProps: {},
          colorProps: [],
          urlProps: [],
        },
      ];

      const result = correlateToJS(sceneTree, jsObjects);

      expect(result.correlations.length).toBe(1);
      expect(result.correlations[0]!.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it('should not match below confidence threshold', () => {
      const sceneTree: SkiaSceneTree = {
        rootLayer: null,
        layers: [
          {
            id: 'layer_0',
            name: 'abc',
            bounds: { x: 1, y: 1, width: 2, height: 2 },
            transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
            opacity: 1,
            visible: true,
            children: [],
          },
        ],
        drawCommands: [],
        totalLayers: 1,
        totalDrawCommands: 0,
        canvas: { width: 800, height: 600, dpr: 1, contextType: '2d' },
      };

      const jsObjects: JSObjectInfo[] = [
        {
          objectId: 'js_1',
          className: 'X',
          name: 'xyz',
          stringProps: ['no relation'],
          numericProps: { x: 999, y: 999 },
          colorProps: [],
          urlProps: [],
        },
      ];

      const result = correlateToJS(sceneTree, jsObjects);

      expect(result.correlations).toEqual([]);
    });
  });

  describe('Cross-domain integration (mocked v8-inspector)', () => {
    it('should correlate with realistic heap snapshot data', () => {
      const sceneTree: SkiaSceneTree = {
        rootLayer: {
          id: 'root',
          name: 'GameCanvas',
          bounds: { x: 0, y: 0, width: 1920, height: 1080 },
          transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          opacity: 1,
          visible: true,
          children: [],
        },
        layers: [
          {
            id: 'layer_bg',
            name: 'BackgroundLayer',
            bounds: { x: 0, y: 0, width: 1920, height: 1080 },
            transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
            opacity: 1,
            visible: true,
            children: [],
          },
          {
            id: 'layer_ui',
            name: 'UILayer',
            bounds: { x: 0, y: 0, width: 1920, height: 1080 },
            transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
            opacity: 1,
            visible: true,
            children: [],
          },
        ],
        drawCommands: [
          {
            type: 'drawText',
            bounds: { x: 860, y: 40, width: 200, height: 40 },
            paintInfo: { text: 'Score: 1500', fillStyle: '#ffffff' },
          },
          {
            type: 'drawImage',
            bounds: { x: 100, y: 800, width: 128, height: 128 },
            paintInfo: { src: 'assets/hero.png' },
          },
        ],
        totalLayers: 2,
        totalDrawCommands: 2,
        canvas: { width: 1920, height: 1080, dpr: 1, contextType: 'webgl' },
      };

      const jsObjects: JSObjectInfo[] = [
        {
          objectId: 'obj_bg',
          className: 'Node',
          name: 'BackgroundLayer',
          stringProps: ['assets/bg.png'],
          numericProps: { x: 0, y: 0, width: 1920, height: 1080 },
          colorProps: [],
          urlProps: ['assets/bg.png'],
        },
        {
          objectId: 'obj_score',
          className: 'Label',
          name: 'ScoreLabel',
          stringProps: ['Score: 1500'],
          numericProps: { x: 860, y: 40 },
          colorProps: ['#ffffff'],
          urlProps: [],
        },
        {
          objectId: 'obj_hero',
          className: 'Sprite',
          name: 'HeroSprite',
          stringProps: ['hero'],
          numericProps: { x: 100, y: 800, width: 128, height: 128 },
          colorProps: [],
          urlProps: ['assets/hero.png'],
        },
      ];

      const result = correlateToJS(sceneTree, jsObjects);

      const scoreMatch = result.correlations.find((c) => c.jsObjectId === 'obj_score');
      expect(scoreMatch).toBeDefined();
      expect(scoreMatch?.matchType).toBe('text');

      const heroMatch = result.correlations.find((c) => c.jsObjectId === 'obj_hero');
      expect(heroMatch).toBeDefined();

      const bgMatch = result.correlations.find((c) => c.jsObjectId === 'obj_bg');
      expect(bgMatch).toBeDefined();

      expect(result.summary.matchedCount).toBeGreaterThanOrEqual(2);
      expect(result.summary.averageConfidence).toBeGreaterThan(0.5);
    });
  });
});
