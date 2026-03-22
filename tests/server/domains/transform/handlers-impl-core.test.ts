import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@utils/WorkerPool', () => ({
  WorkerPool: class MockWorkerPool {
    submit = vi.fn();
    close = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('@src/constants', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    TRANSFORM_WORKER_TIMEOUT_MS: 5000,
    TRANSFORM_CRYPTO_POOL_MAX_WORKERS: 2,
    TRANSFORM_CRYPTO_POOL_IDLE_TIMEOUT_MS: 30000,
    TRANSFORM_CRYPTO_POOL_MAX_OLD_GEN_MB: 64,
    TRANSFORM_CRYPTO_POOL_MAX_YOUNG_GEN_MB: 32,
  };
});

import { TransformToolHandlers } from '@server/domains/transform/handlers.impl.core';



describe('TransformToolHandlers (handlers.impl.core)', () => {
  const collector = {
    getActivePage: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  } as any;

  let handlers: TransformToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new TransformToolHandlers(collector);
  });

  /* ---------- handleAstTransformPreview ---------- */

  describe('handleAstTransformPreview', () => {
    it('returns error when code is missing', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleAstTransformPreview({ transforms: ['constant_fold'] })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.tool).toBe('ast_transform_preview');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('code must be a non-empty string');
    });

    it('returns error when code is empty string', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleAstTransformPreview({ code: '', transforms: ['constant_fold'] })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.tool).toBe('ast_transform_preview');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('code must be a non-empty string');
    });

    it('returns error when transforms is missing', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleAstTransformPreview({ code: 'var x = 1;' }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.tool).toBe('ast_transform_preview');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('transforms');
    });

    it('returns error for invalid transform kind', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleAstTransformPreview({ code: 'var x = 1;', transforms: ['nope'] })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.tool).toBe('ast_transform_preview');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('Unsupported transform');
    });

    it('applies constant_fold and returns diff when preview=true', async () => {
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
      expect(body.diff.length).toBeGreaterThan(0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.transformed).toContain('3');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.original).toBe('const x = 1 + 2;');
    });

    it('returns empty diff when preview=false', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleAstTransformPreview({
          code: 'const x = 1 + 2;',
          transforms: ['constant_fold'],
          preview: false,
        })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.diff).toBe('');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.transformed).toContain('3');
    });

    it('defaults preview to true', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleAstTransformPreview({
          code: 'const x = 1 + 2;',
          transforms: ['constant_fold'],
        })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(typeof body.diff).toBe('string');
    });

    it('returns empty diff when no transforms change the code', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleAstTransformPreview({
          code: 'const x = 1;',
          transforms: ['dead_code_remove'],
          preview: true,
        })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.appliedTransforms).toEqual([]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.diff).toBe('');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.transformed).toBe('const x = 1;');
    });

    it('applies multiple transforms in order', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleAstTransformPreview({
          code: "if(false){dead}else{var a = '\\x48\\x69';}",
          transforms: ['dead_code_remove', 'string_decrypt'],
          preview: true,
        })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.appliedTransforms).toContain('dead_code_remove');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.appliedTransforms).toContain('string_decrypt');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.transformed).toContain('Hi');
    });
  });

  /* ---------- handleAstTransformChain ---------- */

  describe('handleAstTransformChain', () => {
    it('creates a named chain successfully', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleAstTransformChain({
          name: 'my-chain',
          description: 'A test chain',
          transforms: ['constant_fold', 'dead_code_remove'],
        })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.created).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.name).toBe('my-chain');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.transforms).toEqual(['constant_fold', 'dead_code_remove']);
    });

    it('returns error when name is missing', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleAstTransformChain({
          transforms: ['constant_fold'],
        })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.tool).toBe('ast_transform_chain');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('name must be a non-empty string');
    });

    it('returns error when name is empty string', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleAstTransformChain({
          name: '',
          transforms: ['constant_fold'],
        })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.tool).toBe('ast_transform_chain');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('name');
    });

    it('returns error when name is whitespace only', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleAstTransformChain({
          name: '   ',
          transforms: ['constant_fold'],
        })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.tool).toBe('ast_transform_chain');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('name cannot be empty');
    });

    it('trims the chain name', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleAstTransformChain({
          name: '  my-chain  ',
          transforms: ['constant_fold'],
        })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.name).toBe('my-chain');
    });

    it('stores description when provided', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleAstTransformChain({
          name: 'desc-chain',
          description: 'my desc',
          transforms: ['constant_fold'],
        })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.created).toBe(true);
    });

    it('omits description when empty or missing', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleAstTransformChain({
          name: 'no-desc',
          description: '',
          transforms: ['constant_fold'],
        })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.created).toBe(true);
    });

    it('overwrites existing chain with same name', async () => {
      await handlers.handleAstTransformChain({
        name: 'reuse',
        transforms: ['constant_fold'],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleAstTransformChain({
          name: 'reuse',
          transforms: ['dead_code_remove', 'rename_vars'],
        })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.created).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.transforms).toEqual(['dead_code_remove', 'rename_vars']);
    });

    it('returns error for invalid transform in chain', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleAstTransformChain({
          name: 'bad',
          transforms: ['constant_fold', 'invalid_thing'],
        })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.tool).toBe('ast_transform_chain');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('Unsupported transform');
    });
  });

  /* ---------- handleAstTransformApply ---------- */

  describe('handleAstTransformApply', () => {
    it('returns error when neither code nor scriptId is provided', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(await handlers.handleAstTransformApply({}));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.tool).toBe('ast_transform_apply');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('Either code or scriptId must be provided');
    });

    it('applies transforms with inline code', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleAstTransformApply({
          code: 'const y = 2 + 3;',
          transforms: ['constant_fold'],
        })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.transformed).toContain('5');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.stats.originalSize).toBe('const y = 2 + 3;'.length);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.stats.transformedSize).toBeGreaterThan(0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.stats.transformsApplied).toContain('constant_fold');
    });

    it('applies a named chain by chainName', async () => {
      await handlers.handleAstTransformChain({
        name: 'quick',
        transforms: ['constant_fold'],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleAstTransformApply({
          chainName: 'quick',
          code: 'const z = 10 + 20;',
        })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.transformed).toContain('30');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.stats.transformsApplied).toContain('constant_fold');
    });

    it('returns error for unknown chainName', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleAstTransformApply({
          chainName: 'nonexistent',
          code: 'const a = 1;',
        })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.tool).toBe('ast_transform_apply');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('not found');
    });

    it('reports stats with original and transformed sizes', async () => {
      const code = 'if(false){dead}else{var x = 1 + 2;}';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleAstTransformApply({
          code,
          transforms: ['dead_code_remove', 'constant_fold'],
        })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.stats.originalSize).toBe(code.length);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.stats.transformedSize).toBeLessThan(code.length);
    });

    it('prefers inline code over scriptId when both are provided', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleAstTransformApply({
          code: 'const x = 1 + 1;',
          scriptId: 'some-id',
          transforms: ['constant_fold'],
        })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.transformed).toContain('2');
    });

    it('handles empty chainName as no chain (uses inline transforms)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(
        await handlers.handleAstTransformApply({
          chainName: '',
          code: 'const x = 3 + 4;',
          transforms: ['constant_fold'],
        })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.transformed).toContain('7');
    });
  });
});
