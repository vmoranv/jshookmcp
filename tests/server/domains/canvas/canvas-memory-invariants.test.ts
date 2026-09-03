/**
 * canvas_memory_invariants — tests for the new tool that asserts runtime
 * invariants about WebGL context / texture / program lifetimes.
 *
 * Academic basis: JSidentify-V2 (arXiv 2508.01655). Honest boundary per lesson #51:
 * only invariants that are observable from JS (DOM canvas count vs live WebGL
 * contexts; engine info.memory texture/program counts; dangling render targets)
 * are checked. Full GC sweep / native-heap verification is out of scope.
 */

import { describe, expect, it, vi } from 'vitest';
import { handleMemoryInvariants } from '@server/domains/canvas/handlers/memory-invariants';

function parseJson(res: unknown): Record<string, unknown> {
  const r = res as { content: Array<{ type: string; text: string }> };
  return JSON.parse(r.content[0]!.text);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makePageController(): any {
  return { evaluate: vi.fn() };
}

describe('handleMemoryInvariants', () => {
  it('returns the structured response shape with checks[] and violations[]', async () => {
    const pc = makePageController();
    pc.evaluate.mockResolvedValueOnce({
      engine: null,
      canvases: 1,
      webglContexts: 1,
      textures: 0,
      programs: 0,
      buffers: 0,
      sceneNodes: 0,
      engineInfo: null,
      contextLossEvents: 0,
    });

    const json = parseJson(await handleMemoryInvariants(pc, {}));

    expect(json.success).toBe(true);
    expect(Array.isArray(json.checks)).toBe(true);
    expect(Array.isArray(json.violations)).toBe(true);
    expect(Array.isArray(json.recommendations)).toBe(true);
    expect(json.metrics).toBeDefined();
    expect(json.violationCount).toBe(0);
  });

  it('reports a violation when WebGL context count exceeds DOM canvas count + 1 (allowed off-screen)', async () => {
    const pc = makePageController();
    pc.evaluate.mockResolvedValueOnce({
      engine: 'three',
      canvases: 1, // one canvas in the DOM
      webglContexts: 3, // but three live WebGL contexts — one off-screen is allowed, two are orphaned
      textures: 100,
      programs: 10,
      buffers: 50,
      sceneNodes: 200,
      engineInfo: { textureMemoryMB: 12, programCount: 10, geometryCount: 5 },
      contextLossEvents: 0,
    });

    const json = parseJson(await handleMemoryInvariants(pc, {}));

    const violations = json.violations as Array<{ id: string; severity: string }>;
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.id === 'webgl-context-orphan')).toBe(true);
  });

  it('reports a violation when sceneNodes=0 but programs>0 (engine state desync)', async () => {
    const pc = makePageController();
    pc.evaluate.mockResolvedValueOnce({
      engine: 'three',
      canvases: 1,
      webglContexts: 1,
      textures: 5,
      programs: 10,
      buffers: 5,
      sceneNodes: 0, // nothing in scene yet
      engineInfo: { textureMemoryMB: 1, programCount: 10, geometryCount: 0 },
      contextLossEvents: 0,
    });

    const json = parseJson(await handleMemoryInvariants(pc, {}));

    const violations = json.violations as Array<{ id: string }>;
    expect(violations.some((v) => v.id === 'programs-without-scene')).toBe(true);
  });

  it('reports a violation when contextLossEvents > 0 (suggests lost GL context not recovered)', async () => {
    const pc = makePageController();
    pc.evaluate.mockResolvedValueOnce({
      engine: 'three',
      canvases: 1,
      webglContexts: 1,
      textures: 100,
      programs: 20,
      buffers: 50,
      sceneNodes: 100,
      engineInfo: { textureMemoryMB: 50, programCount: 20, geometryCount: 30 },
      contextLossEvents: 3,
    });

    const json = parseJson(await handleMemoryInvariants(pc, {}));

    const violations = json.violations as Array<{ id: string }>;
    expect(violations.some((v) => v.id === 'context-loss-detected')).toBe(true);
  });

  it('produces a clean report when all invariants pass', async () => {
    const pc = makePageController();
    pc.evaluate.mockResolvedValueOnce({
      engine: 'three',
      canvases: 1,
      webglContexts: 1,
      textures: 50,
      programs: 5,
      buffers: 20,
      sceneNodes: 80,
      engineInfo: { textureMemoryMB: 32, programCount: 5, geometryCount: 12 },
      contextLossEvents: 0,
    });

    const json = parseJson(await handleMemoryInvariants(pc, {}));

    expect(json.violationCount).toBe(0);
    expect(json.violations).toEqual([]);
    // Still surfaces safe-cleanup recommendation when GPU memory is non-trivial.
    const recommendations = json.recommendations as Array<{ kind: string }>;
    expect(recommendations.some((r) => r.kind === 'consider-cache-eviction')).toBe(true);
  });

  it('attaches severity + safe-cleanup recommendation to each violation', async () => {
    const pc = makePageController();
    pc.evaluate.mockResolvedValueOnce({
      engine: 'three',
      canvases: 0, // no canvas
      webglContexts: 2, // but two live WebGL contexts — one allowed, one orphaned
      textures: 200,
      programs: 15,
      buffers: 80,
      sceneNodes: 0,
      engineInfo: { textureMemoryMB: 64, programCount: 15, geometryCount: 25 },
      contextLossEvents: 0,
    });

    const json = parseJson(await handleMemoryInvariants(pc, {}));

    const violations = json.violations as Array<{
      id: string;
      severity: string;
      fix: string;
    }>;
    const orphan = violations.find((v) => v.id === 'webgl-context-orphan');
    expect(orphan).toBeDefined();
    expect(['critical', 'high', 'medium', 'low']).toContain(orphan!.severity);
    expect(typeof orphan!.fix).toBe('string');
    expect(orphan!.fix.length).toBeGreaterThan(0);

    const recommendations = json.recommendations as Array<{ kind: string }>;
    expect(recommendations.some((r) => r.kind === 'force-context-release')).toBe(true);
  });

  it('returns success=false on engine evaluation failure without crashing', async () => {
    const pc = makePageController();
    pc.evaluate.mockRejectedValueOnce(new Error('Target closed'));

    const json = parseJson(await handleMemoryInvariants(pc, {}));

    expect(json.success).toBe(false);
    expect(json.error).toContain('Target closed');
    expect(json.violations).toEqual([]);
    expect(json.checks).toEqual([]);
  });

  it('forwards canvasId to the in-page probe', async () => {
    const pc = makePageController();
    pc.evaluate.mockResolvedValueOnce({
      engine: null,
      canvases: 0,
      webglContexts: 0,
      textures: 0,
      programs: 0,
      buffers: 0,
      sceneNodes: 0,
      engineInfo: null,
      contextLossEvents: 0,
    });

    await handleMemoryInvariants(pc, { canvasId: 'game-canvas' });

    const script = pc.evaluate.mock.calls[0][0] as string;
    expect(script).toContain('game-canvas');
  });
});
