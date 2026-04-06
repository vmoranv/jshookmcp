import { describe, expect, it } from 'vitest';
import { canvasTools } from '@server/domains/canvas/definitions';

describe('canvas domain definitions', () => {
  // ── Array shape ───────────────────────────────────────────────────────

  it('exports a non-empty tools array', () => {
    expect(Array.isArray(canvasTools)).toBe(true);
    expect(canvasTools.length).toBeGreaterThan(0);
  });

  it('defines exactly 4 tools', () => {
    expect(canvasTools).toHaveLength(4);
  });

  it('has unique tool names', () => {
    const names = canvasTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every tool has a non-empty description', () => {
    for (const tool of canvasTools) {
      expect(typeof tool.description === 'string').toBe(true);
      expect((tool.description ?? '').trim().length).toBeGreaterThan(0);
    }
  });

  it('every tool has inputSchema.type equal to "object"', () => {
    for (const tool of canvasTools) {
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('every tool has required structure', () => {
    for (const tool of canvasTools) {
      expect(tool).toEqual(
        expect.objectContaining({
          name: expect.any(String),
          description: expect.any(String),
          inputSchema: expect.objectContaining({
            type: 'object',
            properties: expect.any(Object),
          }),
        }),
      );
    }
  });

  // ── Tool names ───────────────────────────────────────────────────────

  it('includes canvas_engine_fingerprint', () => {
    expect(canvasTools.find((t) => t.name === 'canvas_engine_fingerprint')).toBeDefined();
  });

  it('includes canvas_scene_dump', () => {
    expect(canvasTools.find((t) => t.name === 'canvas_scene_dump')).toBeDefined();
  });

  it('includes canvas_pick_object_at_point', () => {
    expect(canvasTools.find((t) => t.name === 'canvas_pick_object_at_point')).toBeDefined();
  });

  it('includes trace_click_to_handler', () => {
    expect(canvasTools.find((t) => t.name === 'trace_click_to_handler')).toBeDefined();
  });

  // ── canvas_engine_fingerprint schema ─────────────────────────────────

  describe('canvas_engine_fingerprint', () => {
    const tool = canvasTools.find((t) => t.name === 'canvas_engine_fingerprint')!;

    it('has canvasId as optional string', () => {
      const prop = tool.inputSchema.properties!.canvasId as Record<string, unknown>;
      expect(prop.type).toBe('string');
      const required: string[] | undefined = tool.inputSchema.required;
      expect(required === undefined || !required.includes('canvasId')).toBe(true);
    });
  });

  // ── canvas_scene_dump schema ─────────────────────────────────────────

  describe('canvas_scene_dump', () => {
    const tool = canvasTools.find((t) => t.name === 'canvas_scene_dump')!;

    it('has canvasId as optional string', () => {
      const prop = tool.inputSchema.properties!.canvasId as Record<string, unknown>;
      expect(prop.type).toBe('string');
      const required: string[] | undefined = tool.inputSchema.required;
      expect(required === undefined || !required.includes('canvasId')).toBe(true);
    });

    it('has maxDepth as optional number with default 20', () => {
      const prop = tool.inputSchema.properties!.maxDepth as Record<string, unknown>;
      expect(prop.type).toBe('number');
      expect(prop.default).toBe(20);
    });

    it('has onlyInteractive as optional boolean with default false', () => {
      const prop = tool.inputSchema.properties!.onlyInteractive as Record<string, unknown>;
      expect(prop.type).toBe('boolean');
      expect(prop.default).toBe(false);
    });

    it('has onlyVisible as optional boolean with default false', () => {
      const prop = tool.inputSchema.properties!.onlyVisible as Record<string, unknown>;
      expect(prop.type).toBe('boolean');
      expect(prop.default).toBe(false);
    });
  });

  // ── canvas_pick_object_at_point schema ──────────────────────────────

  describe('canvas_pick_object_at_point', () => {
    const tool = canvasTools.find((t) => t.name === 'canvas_pick_object_at_point')!;

    it('requires x and y as numbers', () => {
      expect(tool.inputSchema.required).toContain('x');
      expect(tool.inputSchema.required).toContain('y');

      const xProp = tool.inputSchema.properties!.x as Record<string, unknown>;
      const yProp = tool.inputSchema.properties!.y as Record<string, unknown>;
      expect(xProp.type).toBe('number');
      expect(yProp.type).toBe('number');
    });

    it('has canvasId as optional string', () => {
      const prop = tool.inputSchema.properties!.canvasId as Record<string, unknown>;
      expect(prop.type).toBe('string');
      const required: string[] | undefined = tool.inputSchema.required;
      expect(required === undefined || !required.includes('canvasId')).toBe(true);
    });

    it('has highlight as optional boolean with default false', () => {
      const prop = tool.inputSchema.properties!.highlight as Record<string, unknown>;
      expect(prop.type).toBe('boolean');
      expect(prop.default).toBe(false);
    });
  });

  // ── trace_click_to_handler schema ───────────────────────────────────

  describe('trace_click_to_handler', () => {
    const tool = canvasTools.find((t) => t.name === 'trace_click_to_handler')!;

    it('requires x and y as numbers', () => {
      expect(tool.inputSchema.required).toContain('x');
      expect(tool.inputSchema.required).toContain('y');

      const xProp = tool.inputSchema.properties!.x as Record<string, unknown>;
      const yProp = tool.inputSchema.properties!.y as Record<string, unknown>;
      expect(xProp.type).toBe('number');
      expect(yProp.type).toBe('number');
    });

    it('has canvasId as optional string', () => {
      const prop = tool.inputSchema.properties!.canvasId as Record<string, unknown>;
      expect(prop.type).toBe('string');
      const required: string[] | undefined = tool.inputSchema.required;
      expect(required === undefined || !required.includes('canvasId')).toBe(true);
    });

    it('has breakpointType as optional enum with default "click"', () => {
      const prop = tool.inputSchema.properties!.breakpointType as Record<string, unknown>;
      expect(prop.type).toBe('string');
      expect(prop.enum).toEqual(['click', 'mousedown', 'pointerdown']);
      expect(prop.default).toBe('click');
    });

    it('has maxFrames as optional number with default 50', () => {
      const prop = tool.inputSchema.properties!.maxFrames as Record<string, unknown>;
      expect(prop.type).toBe('number');
      expect(prop.default).toBe(50);
    });
  });
});
