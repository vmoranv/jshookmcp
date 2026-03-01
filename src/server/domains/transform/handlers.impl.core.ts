import { TransformToolHandlersCrypto } from './handlers.impl.transform-crypto.js';

export class TransformToolHandlers extends TransformToolHandlersCrypto {
  async handleAstTransformPreview(args: Record<string, unknown>) {
    try {
      const code = this.requireString(args.code, 'code');
      const transforms = this.parseTransforms(args.transforms);
      const preview = this.parseBoolean(args.preview, true);

      const result = this.applyTransforms(code, transforms);
      const diff = preview ? this.buildDiff(code, result.transformed) : '';

      return this.toTextResponse({
        original: code,
        transformed: result.transformed,
        diff,
        appliedTransforms: result.appliedTransforms,
      });
    } catch (error) {
      return this.fail('ast_transform_preview', error);
    }
  }

  async handleAstTransformChain(args: Record<string, unknown>) {
    try {
      const name = this.requireString(args.name, 'name').trim();
      const description =
        typeof args.description === 'string' && args.description.trim().length > 0
          ? args.description.trim()
          : undefined;
      const transforms = this.parseTransforms(args.transforms);

      if (name.length === 0) {
        throw new Error('name cannot be empty');
      }

      this.chains.set(name, {
        name,
        transforms,
        description,
        createdAt: Date.now(),
      });

      return this.toTextResponse({
        name,
        transforms,
        created: true,
      });
    } catch (error) {
      return this.fail('ast_transform_chain', error);
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
            ? await this.resolveScriptSource(scriptId)
            : '';

      if (sourceCode.length === 0) {
        throw new Error('Either code or scriptId must be provided');
      }

      const transforms = this.resolveTransformsForApply(chainName, args.transforms);
      const result = this.applyTransforms(sourceCode, transforms);

      return this.toTextResponse({
        transformed: result.transformed,
        stats: {
          originalSize: sourceCode.length,
          transformedSize: result.transformed.length,
          transformsApplied: result.appliedTransforms,
        },
      });
    } catch (error) {
      return this.fail('ast_transform_apply', error);
    }
  }


}
