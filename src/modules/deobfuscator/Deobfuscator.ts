import crypto from 'crypto';
import type { DeobfuscateOptions, DeobfuscateResult, ObfuscationType } from '@internal-types/index';
import { logger } from '@utils/logger';

import {
  calculateReadabilityScore as calculateReadabilityScoreUtil,
  detectObfuscationType as detectObfuscationTypeUtil,
} from '@modules/deobfuscator/Deobfuscator.utils';
import { runWebcrack } from '@modules/deobfuscator/webcrack';

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
    const cacheKey = this.generateCacheKey(options);
    const cached = this.resultCache.get(cacheKey);
    if (cached) {
      logger.debug('Deobfuscation result from cache');
      cached.cached = true;
      return cached;
    }

    logger.info('Starting webcrack deobfuscation...');
    const startTime = Date.now();

    const obfuscationType = this.detectObfuscationType(options.code);
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

    const webcrackResult = await runWebcrack(options.code, {
      unpack: options.unpack,
      unminify: options.unminify,
      jsx: options.jsx,
      mangle: options.mangle ?? options.renameVariables,
      mappings: options.mappings,
      includeModuleCode: options.includeModuleCode,
      maxBundleModules: options.maxBundleModules,
      outputDir: options.outputDir,
      forceOutput: options.forceOutput,
    });

    if (!webcrackResult.applied) {
      const reason = webcrackResult.reason ?? 'webcrack did not return a result';
      logger.error(`webcrack deobfuscation failed: ${reason}`);
      throw new Error(reason);
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
