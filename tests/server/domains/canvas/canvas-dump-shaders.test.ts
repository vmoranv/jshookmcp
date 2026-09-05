/**
 * canvas_dump_shaders — tests for the new tool that walks an engine's shader
 * programs and returns source + uniforms (academic backing: WGPULens arXiv 2606.26412
 * + DarthShader arXiv 2409.01824; honest boundary per lesson #51: only returns
 * source code the engine actually exposes).
 */

import { describe, expect, it, vi } from 'vitest';
import { handleDumpShaders } from '@server/domains/canvas/handlers/shader-dump';

function parseJson(res: unknown): Record<string, unknown> {
  const r = res as { content: Array<{ type: string; text: string }> };
  return JSON.parse(r.content[0]!.text);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makePageController(): any {
  return { evaluate: vi.fn() };
}

describe('handleDumpShaders', () => {
  it('returns the structured response shape', async () => {
    const pc = makePageController();
    pc.evaluate.mockResolvedValueOnce({
      programs: [
        {
          name: 'basic',
          vertexShader: 'void main(){}',
          fragmentShader: 'void main(){}',
          uniforms: {},
        },
      ],
      engine: 'three',
      totalPrograms: 1,
    });

    const res = await handleDumpShaders(pc, {});
    const json = parseJson(res);

    expect(json.success).toBe(true);
    expect(json.engine).toBe('three');
    expect(json.totalPrograms).toBe(1);
    expect(Array.isArray(json.programs)).toBe(true);
    expect(json.programs).toHaveLength(1);
  });

  it('passes includeUniforms=false to drop uniform maps (smaller payload)', async () => {
    const pc = makePageController();
    pc.evaluate.mockResolvedValueOnce({
      programs: [
        {
          name: 'p1',
          vertexShader: 'vs',
          fragmentShader: 'fs',
          uniforms: { u_time: { type: 'float' } },
        },
      ],
      engine: 'three',
      totalPrograms: 1,
    });

    const json = parseJson(await handleDumpShaders(pc, { includeUniforms: false }));

    const program = (json.programs as Array<Record<string, unknown>>)[0]!;
    expect(program.uniforms).toEqual({});
    expect(program.name).toBe('p1');
    expect(program.vertexShader).toBe('vs');
  });

  it('keeps uniforms when includeUniforms=true (default true)', async () => {
    const pc = makePageController();
    pc.evaluate.mockResolvedValueOnce({
      programs: [
        {
          name: 'p1',
          vertexShader: 'vs',
          fragmentShader: 'fs',
          uniforms: { u_time: { type: 'float' } },
        },
      ],
      engine: 'three',
      totalPrograms: 1,
    });

    const json = parseJson(await handleDumpShaders(pc, {}));

    const program = (json.programs as Array<Record<string, unknown>>)[0]!;
    expect(program.uniforms).toEqual({ u_time: { type: 'float' } });
  });

  it('honors maxPrograms cap by truncating the programs array', async () => {
    const pc = makePageController();
    pc.evaluate.mockResolvedValueOnce({
      programs: Array.from({ length: 10 }, (_, i) => ({
        name: `p${i}`,
        vertexShader: 'vs',
        fragmentShader: 'fs',
        uniforms: {},
      })),
      engine: 'three',
      totalPrograms: 10,
    });

    const json = parseJson(await handleDumpShaders(pc, { maxPrograms: 3 }));

    expect(json.totalPrograms).toBe(10);
    expect(json.truncated).toBe(true);
    expect((json.programs as unknown[]).length).toBe(3);
  });

  it('reports an empty programs array + honest reason when the engine exposes no shaders', async () => {
    const pc = makePageController();
    pc.evaluate.mockResolvedValueOnce({
      programs: [],
      engine: 'pixi',
      totalPrograms: 0,
      reason: 'engine does not expose shader source on this runtime',
    });

    const json = parseJson(await handleDumpShaders(pc, {}));

    expect(json.success).toBe(true);
    expect(json.engine).toBe('pixi');
    expect(json.totalPrograms).toBe(0);
    expect((json.programs as unknown[]).length).toBe(0);
    expect(json.reason).toContain('does not expose');
  });

  it('returns success=false on engine evaluation failure without crashing', async () => {
    const pc = makePageController();
    pc.evaluate.mockRejectedValueOnce(new Error('CDP disconnected'));

    const json = parseJson(await handleDumpShaders(pc, {}));

    expect(json.success).toBe(false);
    expect(json.error).toContain('CDP disconnected');
    expect(json.programs).toEqual([]);
    expect(json.totalPrograms).toBe(0);
  });

  it('forwards canvasId to the in-page probe', async () => {
    const pc = makePageController();
    pc.evaluate.mockResolvedValueOnce({
      programs: [],
      engine: 'three',
      totalPrograms: 0,
    });

    await handleDumpShaders(pc, { canvasId: 'game-canvas' });

    const script = pc.evaluate.mock.calls[0][0] as string;
    expect(script).toContain('game-canvas');
  });

  it('accepts an explicit engine hint to skip fingerprinting', async () => {
    const pc = makePageController();
    pc.evaluate.mockResolvedValueOnce({
      programs: [{ name: 'lit', vertexShader: '', fragmentShader: '', uniforms: {} }],
      engine: 'babylon',
      totalPrograms: 1,
    });

    const json = parseJson(await handleDumpShaders(pc, { engine: 'babylon' }));

    expect(json.success).toBe(true);
    expect(json.engine).toBe('babylon');
    // Only one evaluate call — fingerprint skipped because engine was explicit.
    expect(pc.evaluate).toHaveBeenCalledTimes(1);
  });
});

describe('canvas_dump_shaders in-page payload (executed, not mocked)', () => {
  it('returns Babylon shader sources from Effect.ShadersStore (regression: store values are GLSL source strings)', async () => {
    const pc = makePageController();
    pc.evaluate.mockResolvedValue({
      programs: [],
      engine: 'babylon',
      totalPrograms: 0,
      reason: null,
    });
    await handleDumpShaders(pc, { engine: 'babylon' });
    const payload = pc.evaluate.mock.calls[0]![0] as string;

    const fakeCanvas = {
      getContext: (_t: string) => ({ getExtension: () => null }),
    };
    const stubWindow = {
      BABYLON: {
        Effect: {
          ShadersStore: {
            myShader: 'void main() { gl_Position = vec4(1.0); }',
            myShaderFragment: 'void main() { gl_FragColor = vec4(0.0); }',
            helperFragment: 'void main() {}',
          },
        },
      },
    };
    const stubDocument = {
      querySelectorAll: () => [fakeCanvas],
      getElementById: () => null,
    };

    const raw = new Function('window', 'document', `return (${payload});`)(
      stubWindow,
      stubDocument,
    ) as {
      engine: string;
      totalPrograms: number;
      programs: Array<{ name: string; vertexShader: string; fragmentShader: string }>;
      reason: string | null;
    };

    expect(raw.engine).toBe('babylon');
    // "myShader" + "myShaderFragment" pair into one program entry;
    // the Fragment-suffixed keys must not be skipped as non-programs.
    expect(raw.totalPrograms).toBe(1);
    expect(raw.programs).toHaveLength(1);
    expect(raw.programs[0]!.name).toBe('myShader');
    expect(raw.programs[0]!.vertexShader).toContain('gl_Position');
    expect(raw.programs[0]!.fragmentShader).toContain('gl_FragColor');
  });

  it('honors maxPrograms in the in-page enumeration (not a hard-coded 200)', async () => {
    const pc = makePageController();
    pc.evaluate.mockResolvedValue({
      programs: [],
      engine: 'babylon',
      totalPrograms: 0,
      reason: null,
    });
    await handleDumpShaders(pc, { engine: 'babylon', maxPrograms: 2 });
    const payload = pc.evaluate.mock.calls[0]![0] as string;
    expect(payload).toContain('var maxPrograms = 2;');
    expect(payload).not.toContain('Math.min(names.length, 200)');
  });
});
