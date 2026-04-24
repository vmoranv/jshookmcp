import crypto from 'crypto';
import { z } from 'zod';
import type { DeobfuscateOptions, DeobfuscateResult, ObfuscationType } from '@internal-types/index';
import { logger } from '@utils/logger';

import {
  calculateReadabilityScore as calculateReadabilityScoreUtil,
  detectObfuscationType as detectObfuscationTypeUtil,
} from '@modules/deobfuscator/Deobfuscator.utils';
import { runWebcrack } from '@modules/deobfuscator/webcrack';
import { deobfuscateWithProApi } from '@modules/deobfuscator/ProApiClient';

// Pro API token validation
const MIN_API_TOKEN_LENGTH = 10;

// Input validation schema
const DeobfuscateOptionsSchema = z.object({
  code: z.string().min(1, 'Code must not be empty'),
  aggressive: z.boolean().optional(),
  unpack: z.boolean().default(true),
  unminify: z.boolean().default(true),
  jsx: z.boolean().default(false),
  mangle: z.boolean().default(false),
  renameVariables: z.boolean().optional(),
  includeModuleCode: z.boolean().default(false),
  maxBundleModules: z.number().int().positive().default(100),
  outputDir: z.string().optional(),
  forceOutput: z.boolean().default(false),
  preserveLogic: z.boolean().optional(),
  inlineFunctions: z.boolean().optional(),
  proApiToken: z
    .string()
    .min(MIN_API_TOKEN_LENGTH, `API token must be at least ${MIN_API_TOKEN_LENGTH} characters`)
    .optional(),
  proApiVersion: z.string().optional(),
  mappings: z
    .array(
      z.object({
        path: z.string(),
        pattern: z.string(),
        matchType: z.enum(['includes', 'regex', 'exact']).optional(),
        target: z.enum(['code', 'path']).optional(),
      }),
    )
    .optional(),
});

export class Deobfuscator {
  private resultCache = new Map<string, DeobfuscateResult>();
  private maxCacheSize = 100;

  constructor(legacyDependency?: unknown) {
    void legacyDependency;
  }

  private generateCacheKey(options: DeobfuscateOptions): string {
    const key = JSON.stringify({
      aggressive: options.aggressive,
      code: options.code.substring(0, 2000),
      forceOutput: options.forceOutput,
      includeModuleCode: options.includeModuleCode,
      inlineFunctions: options.inlineFunctions,
      jsx: options.jsx,
      llm: false /* llm removed */,
      mangle: options.mangle ?? options.renameVariables,
      mappings: options.mappings,
      maxBundleModules: options.maxBundleModules,
      outputDir: options.outputDir,
      preserveLogic: options.preserveLogic,
      unpack: options.unpack,
      unminify: options.unminify,
    });
    return crypto.createHash('md5').update(key).digest('hex');
  }

  async deobfuscate(options: DeobfuscateOptions): Promise<DeobfuscateResult> {
    // Validate input
    const validatedOptions = DeobfuscateOptionsSchema.parse(options);
    const cacheKey = this.generateCacheKey(validatedOptions);
    const cached = this.resultCache.get(cacheKey);
    if (cached) {
      logger.debug('Deobfuscation result from cache');
      cached.cached = true;
      return cached;
    }

    // Check for Pro API token and use if available
    const proApiToken =
      (validatedOptions as any).proApiToken || process.env.OBFUSCATOR_IO_API_TOKEN;
    const hasProFeatures =
      (validatedOptions as any).vmObfuscation === true ||
      (validatedOptions as any).parseHtml === true ||
      (proApiToken && proApiToken.length > 0);

    if (hasProFeatures && proApiToken && proApiToken.length > 0) {
      const proResult = await deobfuscateWithProApi(validatedOptions);
      if (proResult) {
        logger.success('Pro API deobfuscation completed successfully');
        return proResult;
      } else {
        logger.warn('Pro API usage requested but failed, falling back to webcrack');
      }
    }

    logger.info('Starting webcrack deobfuscation...');
    const startTime = Date.now();

    const obfuscationType = this.detectObfuscationType(validatedOptions.code);
    const warnings: string[] = [];

    if (options.aggressive !== undefined) {
      warnings.push(
        'aggressive is deprecated and ignored; webcrack is now the only deobfuscation engine.',
      );
    }
    if (options.preserveLogic !== undefined) {
      warnings.push('preserveLogic is deprecated and ignored.');
    }
    if (options.inlineFunctions !== undefined) {
      warnings.push('inlineFunctions is deprecated and ignored.');
    }

    const webcrackInvocationOptions = {
      unpack: validatedOptions.unpack,
      unminify: validatedOptions.unminify,
      jsx: validatedOptions.jsx,
      mangle: validatedOptions.mangle ?? validatedOptions.renameVariables,
      mappings: validatedOptions.mappings as any,
      includeModuleCode: validatedOptions.includeModuleCode,
      maxBundleModules: validatedOptions.maxBundleModules,
      outputDir: validatedOptions.outputDir,
      forceOutput: validatedOptions.forceOutput,
    };

    const webcrackResultInternal = await Promise.race([
      runWebcrack(validatedOptions.code, webcrackInvocationOptions),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('webcrack timeout after 30 seconds')), 30_000),
      ).catch((err) => {
        logger.warn(`webcrack timeout: ${err instanceof Error ? err.message : String(err)}`);
        return { applied: false, reason: 'timeout' } as Awaited<ReturnType<typeof runWebcrack>>;
      }),
    ]);

    const webcrackResult = webcrackResultInternal;

    if (!webcrackResultInternal.applied) {
      const reason = webcrackResultInternal.reason ?? 'webcrack did not return a result';
      // Fallback to cached result if available
      if (this.resultCache.has(cacheKey)) {
        logger.warn(`webcrack failed (${reason}), falling back to cached result`);
        const cachedResult = this.resultCache.get(cacheKey)!;
        cachedResult.warnings = [`webcrack failed: ${reason}`];
        return cachedResult;
      }

      const errorDetails = {
        error: 'DeobfuscationFailed',
        reason,
        timestamp: new Date().toISOString(),
        context: {
          optionsUsed: webcrackResultInternal.optionsUsed,
          codePreview: validatedOptions.code.substring(0, 500),
        },
      };
      logger.error(`webcrack deobfuscation failed: ${JSON.stringify(errorDetails)}`);
      throw new Error(JSON.stringify(errorDetails));
    }

    const analysis = this.buildAnalysis(webcrackResult, obfuscationType);

    const transformations = [
      {
        type: 'webcrack',
        description: `Ran webcrack (unminify=${webcrackResult.optionsUsed.unminify}, unpack=${webcrackResult.optionsUsed.unpack}, jsx=${webcrackResult.optionsUsed.jsx}, mangle=${webcrackResult.optionsUsed.mangle})`,
        success: true,
      },
      ...(webcrackResult.bundle
        ? [
            {
              type: 'webcrack-unpack',
              description: `Recovered ${webcrackResult.bundle.moduleCount} bundled modules`,
              success: true,
            },
          ]
        : []),
      ...(webcrackResult.savedTo
        ? [
            {
              type: 'webcrack-save',
              description: `Saved webcrack artifacts to ${webcrackResult.savedTo}`,
              success: true,
            },
          ]
        : []),
    ];

    const readabilityScore = this.calculateReadabilityScore(webcrackResult.code);
    const confidence = this.calculateConfidence(webcrackResult, readabilityScore);
    const duration = Date.now() - startTime;

    logger.success(
      `webcrack deobfuscation completed in ${duration}ms (confidence: ${(confidence * 100).toFixed(1)}%)`,
    );

    const result: DeobfuscateResult = {
      code: webcrackResult.code,
      readabilityScore,
      confidence,
      obfuscationType,
      transformations,
      analysis,
      bundle: webcrackResult.bundle,
      savedTo: webcrackResult.savedTo,
      savedArtifacts: webcrackResult.savedArtifacts,
      warnings: warnings.length > 0 ? warnings : undefined,
      engine: 'webcrack',
      webcrackApplied: true,
    };

    if (this.resultCache.size >= this.maxCacheSize) {
      const firstKey = this.resultCache.keys().next().value;
      if (firstKey) {
        this.resultCache.delete(firstKey);
      }
    }
    result.cached = false;
    this.resultCache.set(cacheKey, result);

    return result;
  }

  private detectObfuscationType(code: string): ObfuscationType[] {
    return detectObfuscationTypeUtil(code);
  }

  private calculateReadabilityScore(code: string): number {
    return calculateReadabilityScoreUtil(code);
  }

  private calculateConfidence(
    webcrackResult: Awaited<ReturnType<typeof runWebcrack>>,
    readabilityScore: number,
  ): number {
    let confidence = 0.7;
    confidence += readabilityScore / 500;

    if (webcrackResult.bundle) {
      confidence += 0.1;
    }
    if (webcrackResult.savedTo) {
      confidence += 0.05;
    }

    return Math.min(confidence, 0.99);
  }

  private buildAnalysis(
    webcrackResult: Awaited<ReturnType<typeof runWebcrack>>,
    obfuscationType: ObfuscationType[],
  ): string {
    const parts = [
      `webcrack completed deobfuscation for detected types: ${obfuscationType.join(', ')}.`,
    ];

    if (webcrackResult.bundle) {
      parts.push(
        `Recovered a ${webcrackResult.bundle.type} bundle with ${webcrackResult.bundle.moduleCount} modules.`,
      );
    }

    if (webcrackResult.savedTo) {
      parts.push(`Artifacts saved to ${webcrackResult.savedTo}.`);
    }

    return parts.join(' ');
  }
}
