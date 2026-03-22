import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TransformToolHandlers } from '@server/domains/transform/handlers';



describe('TransformToolHandlers', () => {
  const collector = {
    getActivePage: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  } as any;

  let handlers: TransformToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new TransformToolHandlers(collector);
  });

  it('returns error when ast_transform_preview has no code', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(
      await handlers.handleAstTransformPreview({ transforms: ['constant_fold'] })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.tool).toBe('ast_transform_preview');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toContain('code must be a non-empty string');
  });

  it('applies transform preview and returns diff', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(
      await handlers.handleAstTransformPreview({
        code: 'const x = 1 + 2;',
        transforms: ['constant_fold'],
        preview: true,
      })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.appliedTransforms).toContain('constant_fold');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(typeof body.diff).toBe('string');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.transformed).toContain('3');
  });

  it('creates a named transform chain', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(
      await handlers.handleAstTransformChain({
        name: 'fast',
        description: 'opt chain',
        transforms: ['constant_fold', 'dead_code_remove'],
      })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.created).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.name).toBe('fast');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.transforms).toEqual(['constant_fold', 'dead_code_remove']);
  });

  it('applies transform chain by chainName', async () => {
    await handlers.handleAstTransformChain({
      name: 'fast',
      transforms: ['constant_fold'],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(
      await handlers.handleAstTransformApply({
        chainName: 'fast',
        code: 'const y = 2 + 3;',
      })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.stats.transformsApplied).toContain('constant_fold');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.transformed).toContain('5');
  });

  it('returns error when ast_transform_apply has no code or scriptId', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(await handlers.handleAstTransformApply({}));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.tool).toBe('ast_transform_apply');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toContain('Either code or scriptId');
  });

  it('returns error for unknown chainName', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(
      await handlers.handleAstTransformApply({
        chainName: 'missing',
        code: 'const z = 1;',
      })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toContain('not found');
  });
});
