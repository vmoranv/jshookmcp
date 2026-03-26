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
  } as any;

  let handlers: TransformToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new TransformToolHandlers(collector);
  });

  /* ---------- handleAstTransformPreview ---------- */

  describe('handleAstTransformPreview', () => {
    it('returns error when code is missing', async () => {
      const body = parseJson<any>(
        await handlers.handleAstTransformPreview({ transforms: ['constant_fold'] }),
      );
      expect(body.tool).toBe('ast_transform_preview');
      expect(body.error).toContain('code must be a non-empty string');
    });

    it('returns error when code is empty string', async () => {
      const body = parseJson<any>(
        await handlers.handleAstTransformPreview({ code: '', transforms: ['constant_fold'] }),
      );
      expect(body.tool).toBe('ast_transform_preview');
      expect(body.error).toContain('code must be a non-empty string');
    });

    it('returns error when transforms is missing', async () => {
      const body = parseJson<any>(await handlers.handleAstTransformPreview({ code: 'var x = 1;' }));
      expect(body.tool).toBe('ast_transform_preview');
      expect(body.error).toContain('transforms');
    });

    it('returns error for invalid transform kind', async () => {
      const body = parseJson<any>(
        await handlers.handleAstTransformPreview({ code: 'var x = 1;', transforms: ['nope'] }),
      );
      expect(body.tool).toBe('ast_transform_preview');
      expect(body.error).toContain('Unsupported transform');
    });

    it('applies constant_fold and returns diff when preview=true', async () => {
      const body = parseJson<any>(
        await handlers.handleAstTransformPreview({
          code: 'const x = 1 + 2;',
          transforms: ['constant_fold'],
          preview: true,
        }),
      );
      expect(body.appliedTransforms).toContain('constant_fold');
      expect(typeof body.diff).toBe('string');
      expect(body.diff.length).toBeGreaterThan(0);
      expect(body.transformed).toContain('3');
      expect(body.original).toBe('const x = 1 + 2;');
    });

    it('returns empty diff when preview=false', async () => {
      const body = parseJson<any>(
        await handlers.handleAstTransformPreview({
          code: 'const x = 1 + 2;',
          transforms: ['constant_fold'],
          preview: false,
        }),
      );
      expect(body.diff).toBe('');
      expect(body.transformed).toContain('3');
    });

    it('defaults preview to true', async () => {
      const body = parseJson<any>(
        await handlers.handleAstTransformPreview({
          code: 'const x = 1 + 2;',
          transforms: ['constant_fold'],
        }),
      );
      expect(typeof body.diff).toBe('string');
    });

    it('returns empty diff when no transforms change the code', async () => {
      const body = parseJson<any>(
        await handlers.handleAstTransformPreview({
          code: 'const x = 1;',
          transforms: ['dead_code_remove'],
          preview: true,
        }),
      );
      expect(body.appliedTransforms).toEqual([]);
      expect(body.diff).toBe('');
      expect(body.transformed).toBe('const x = 1;');
    });

    it('applies multiple transforms in order', async () => {
      const body = parseJson<any>(
        await handlers.handleAstTransformPreview({
          code: "if(false){dead}else{var a = '\\x48\\x69';}",
          transforms: ['dead_code_remove', 'string_decrypt'],
          preview: true,
        }),
      );
      expect(body.appliedTransforms).toContain('dead_code_remove');
      expect(body.appliedTransforms).toContain('string_decrypt');
      expect(body.transformed).toContain('Hi');
    });
  });

  /* ---------- handleAstTransformChain ---------- */

  describe('handleAstTransformChain', () => {
    it('creates a named chain successfully', async () => {
      const body = parseJson<any>(
        await handlers.handleAstTransformChain({
          name: 'my-chain',
          description: 'A test chain',
          transforms: ['constant_fold', 'dead_code_remove'],
        }),
      );
      expect(body.created).toBe(true);
      expect(body.name).toBe('my-chain');
      expect(body.transforms).toEqual(['constant_fold', 'dead_code_remove']);
    });

    it('returns error when name is missing', async () => {
      const body = parseJson<any>(
        await handlers.handleAstTransformChain({
          transforms: ['constant_fold'],
        }),
      );
      expect(body.tool).toBe('ast_transform_chain');
      expect(body.error).toContain('name must be a non-empty string');
    });

    it('returns error when name is empty string', async () => {
      const body = parseJson<any>(
        await handlers.handleAstTransformChain({
          name: '',
          transforms: ['constant_fold'],
        }),
      );
      expect(body.tool).toBe('ast_transform_chain');
      expect(body.error).toContain('name');
    });

    it('returns error when name is whitespace only', async () => {
      const body = parseJson<any>(
        await handlers.handleAstTransformChain({
          name: '   ',
          transforms: ['constant_fold'],
        }),
      );
      expect(body.tool).toBe('ast_transform_chain');
      expect(body.error).toContain('name cannot be empty');
    });

    it('trims the chain name', async () => {
      const body = parseJson<any>(
        await handlers.handleAstTransformChain({
          name: '  my-chain  ',
          transforms: ['constant_fold'],
        }),
      );
      expect(body.name).toBe('my-chain');
    });

    it('stores description when provided', async () => {
      const body = parseJson<any>(
        await handlers.handleAstTransformChain({
          name: 'desc-chain',
          description: 'my desc',
          transforms: ['constant_fold'],
        }),
      );
      expect(body.created).toBe(true);
    });

    it('omits description when empty or missing', async () => {
      const body = parseJson<any>(
        await handlers.handleAstTransformChain({
          name: 'no-desc',
          description: '',
          transforms: ['constant_fold'],
        }),
      );
      expect(body.created).toBe(true);
    });

    it('overwrites existing chain with same name', async () => {
      await handlers.handleAstTransformChain({
        name: 'reuse',
        transforms: ['constant_fold'],
      });

      const body = parseJson<any>(
        await handlers.handleAstTransformChain({
          name: 'reuse',
          transforms: ['dead_code_remove', 'rename_vars'],
        }),
      );
      expect(body.created).toBe(true);
      expect(body.transforms).toEqual(['dead_code_remove', 'rename_vars']);
    });

    it('returns error for invalid transform in chain', async () => {
      const body = parseJson<any>(
        await handlers.handleAstTransformChain({
          name: 'bad',
          transforms: ['constant_fold', 'invalid_thing'],
        }),
      );
      expect(body.tool).toBe('ast_transform_chain');
      expect(body.error).toContain('Unsupported transform');
    });
  });

  /* ---------- handleAstTransformApply ---------- */

  describe('handleAstTransformApply', () => {
    it('returns error when neither code nor scriptId is provided', async () => {
      const body = parseJson<any>(await handlers.handleAstTransformApply({}));
      expect(body.tool).toBe('ast_transform_apply');
      expect(body.error).toContain('Either code or scriptId must be provided');
    });

    it('applies transforms with inline code', async () => {
      const body = parseJson<any>(
        await handlers.handleAstTransformApply({
          code: 'const y = 2 + 3;',
          transforms: ['constant_fold'],
        }),
      );
      expect(body.transformed).toContain('5');
      expect(body.stats.originalSize).toBe('const y = 2 + 3;'.length);
      expect(body.stats.transformedSize).toBeGreaterThan(0);
      expect(body.stats.transformsApplied).toContain('constant_fold');
    });

    it('applies a named chain by chainName', async () => {
      await handlers.handleAstTransformChain({
        name: 'quick',
        transforms: ['constant_fold'],
      });

      const body = parseJson<any>(
        await handlers.handleAstTransformApply({
          chainName: 'quick',
          code: 'const z = 10 + 20;',
        }),
      );
      expect(body.transformed).toContain('30');
      expect(body.stats.transformsApplied).toContain('constant_fold');
    });

    it('returns error for unknown chainName', async () => {
      const body = parseJson<any>(
        await handlers.handleAstTransformApply({
          chainName: 'nonexistent',
          code: 'const a = 1;',
        }),
      );
      expect(body.tool).toBe('ast_transform_apply');
      expect(body.error).toContain('not found');
    });

    it('reports stats with original and transformed sizes', async () => {
      const code = 'if(false){dead}else{var x = 1 + 2;}';
      const body = parseJson<any>(
        await handlers.handleAstTransformApply({
          code,
          transforms: ['dead_code_remove', 'constant_fold'],
        }),
      );
      expect(body.stats.originalSize).toBe(code.length);
      expect(body.stats.transformedSize).toBeLessThan(code.length);
    });

    it('prefers inline code over scriptId when both are provided', async () => {
      const body = parseJson<any>(
        await handlers.handleAstTransformApply({
          code: 'const x = 1 + 1;',
          scriptId: 'some-id',
          transforms: ['constant_fold'],
        }),
      );
      expect(body.transformed).toContain('2');
    });

    it('handles empty chainName as no chain (uses inline transforms)', async () => {
      const body = parseJson<any>(
        await handlers.handleAstTransformApply({
          chainName: '',
          code: 'const x = 3 + 4;',
          transforms: ['constant_fold'],
        }),
      );
      expect(body.transformed).toContain('7');
    });
  });
});
