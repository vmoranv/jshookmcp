import { describe, expect, it, vi } from 'vitest';
import {
  installShaderSourceHook,
  getCapturedShaders,
  type CapturedShader,
} from '@modules/webgpu/ShaderSourceHook';

function mockPage(returnValue: unknown = undefined) {
  return {
    evaluate: vi.fn().mockResolvedValue(returnValue),
    evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
  };
}

describe('ShaderSourceHook', () => {
  it('serializes GPUCompilationInfo into plain objects in-page', async () => {
    const page = mockPage();
    await installShaderSourceHook(page as never, 5);

    const call = (page.evaluate as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => typeof c[0] === 'function' && String(c[0]).includes('createShaderModule'),
    );
    const source = String(call?.[0] ?? '');

    expect(source).toContain('messages: Array.from');
    expect(source).toContain('lineNum:');
    expect(source).toContain('linePos:');
  });

  it('returns captured shader state', async () => {
    const state = {
      shaders: [{ code: '@vertex fn main() {}', timestamp: 1 }] as CapturedShader[],
      totalCreated: 1,
    };
    const page = mockPage(state);

    await expect(getCapturedShaders(page as never)).resolves.toEqual(state);
  });
});
