/**
 * AST transform sub-handler — preview, chain, and apply operations.
 */

import type { TransformSharedState } from './shared';
import {
  requireString,
  parseTransforms,
  parseBoolean,
  resolveScriptSource,
  toTextResponse,
  fail,
} from './shared';
import { resolveTransformsForApply, applyTransforms, buildDiff } from './transform-operations';

export class AstHandlers {
  private state: TransformSharedState;

  constructor(state: TransformSharedState) {
    this.state = state;
  }

  async handleAstTransformPreview(args: Record<string, unknown>) {
    try {
      const code = requireString(args.code, 'code');
      const transforms = parseTransforms(args.transforms);
      const preview = parseBoolean(args.preview, true);

      const result = applyTransforms(code, transforms);
      const diff = preview ? buildDiff(code, result.transformed) : '';

      return toTextResponse({
        original: code,
        transformed: result.transformed,
        diff,
        appliedTransforms: result.appliedTransforms,
      });
    } catch (error) {
      return fail('ast_transform_preview', error);
    }
  }

  async handleAstTransformChain(args: Record<string, unknown>) {
    try {
      const name = requireString(args.name, 'name').trim();
      const description =
        typeof args.description === 'string' && args.description.trim().length > 0
          ? args.description.trim()
          : undefined;
      const transforms = parseTransforms(args.transforms);

      if (name.length === 0) throw new Error('name cannot be empty');

      this.state.chains.set(name, {
        name,
        transforms,
        description,
        createdAt: Date.now(),
      });

      return toTextResponse({ name, transforms, created: true });
    } catch (error) {
      return fail('ast_transform_chain', error);
    }
  }

  async handleAstTransformApply(args: Record<string, unknown>) {
    try {
      const chainName = typeof args.chainName === 'string' ? args.chainName.trim() : '';
      const inlineCode = typeof args.code === 'string' ? args.code : '';
      const scriptId = typeof args.scriptId === 'string' ? args.scriptId.trim() : '';

      const sourceCode =
        inlineCode.length > 0
          ? inlineCode
          : scriptId.length > 0
            ? await resolveScriptSource(this.state.collector, scriptId)
            : '';

      if (sourceCode.length === 0) throw new Error('Either code or scriptId must be provided');

      const transforms = resolveTransformsForApply(this.state.chains, chainName, args.transforms);
      const result = applyTransforms(sourceCode, transforms);

      return toTextResponse({
        transformed: result.transformed,
        stats: {
          originalSize: sourceCode.length,
          transformedSize: result.transformed.length,
          transformsApplied: result.appliedTransforms,
        },
      });
    } catch (error) {
      return fail('ast_transform_apply', error);
    }
  }
}
