import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TransformToolHandlers } from '../../../../src/server/domains/transform/handlers.js';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('TransformToolHandlers', () => {
  const collector = {
    getActivePage: vi.fn(),
  } as any;

  let handlers: TransformToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new TransformToolHandlers(collector);
  });

  it('returns error when ast_transform_preview has no code', async () => {
    const body = parseJson(await handlers.handleAstTransformPreview({ transforms: ['constant_fold'] }));
    expect(body.tool).toBe('ast_transform_preview');
    expect(body.error).toContain('code must be a non-empty string');
  });

  it('applies transform preview and returns diff', async () => {
    const body = parseJson(
      await handlers.handleAstTransformPreview({
        code: 'const x = 1 + 2;',
        transforms: ['constant_fold'],
        preview: true,
      })
    );
    expect(body.appliedTransforms).toContain('constant_fold');
    expect(typeof body.diff).toBe('string');
    expect(body.transformed).toContain('3');
  });

  it('creates a named transform chain', async () => {
    const body = parseJson(
      await handlers.handleAstTransformChain({
        name: 'fast',
        description: 'opt chain',
        transforms: ['constant_fold', 'dead_code_remove'],
      })
    );
    expect(body.created).toBe(true);
    expect(body.name).toBe('fast');
    expect(body.transforms).toEqual(['constant_fold', 'dead_code_remove']);
  });

  it('applies transform chain by chainName', async () => {
    await handlers.handleAstTransformChain({
      name: 'fast',
      transforms: ['constant_fold'],
    });

    const body = parseJson(
      await handlers.handleAstTransformApply({
        chainName: 'fast',
        code: 'const y = 2 + 3;',
      })
    );
    expect(body.stats.transformsApplied).toContain('constant_fold');
    expect(body.transformed).toContain('5');
  });

  it('returns error when ast_transform_apply has no code or scriptId', async () => {
    const body = parseJson(await handlers.handleAstTransformApply({}));
    expect(body.tool).toBe('ast_transform_apply');
    expect(body.error).toContain('Either code or scriptId');
  });

  it('returns error for unknown chainName', async () => {
    const body = parseJson(
      await handlers.handleAstTransformApply({
        chainName: 'missing',
        code: 'const z = 1;',
      })
    );
    expect(body.error).toContain('not found');
  });
});
