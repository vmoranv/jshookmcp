import crypto from 'node:crypto';
import type { DeobfuscateOptions, DeobfuscateResult, ObfuscationType } from '@internal-types/index';
import { logger } from '@utils/logger';

import {
  calculateReadabilityScore as calculateReadabilityScoreUtil,
  detectObfuscationType as detectObfuscationTypeUtil,
} from '@modules/deobfuscator/Deobfuscator.utils';
import { runWebcrack } from '@modules/deobfuscator/webcrack';
import type { WebcrackPool } from '@modules/deobfuscator/webcrack-worker';

export class Deobfuscator {
  private resultCache = new Map<string, DeobfuscateResult>();
  private maxCacheSize = 100;

  constructor(legacyDependency?: unknown) {
    void legacyDependency;
  }

  private generateCacheKey(options: DeobfuscateOptions): string {
    const key = JSON.stringify({
      // Hash the FULL code plus its length: prefix-truncation (substring(0, 2000))
      // let samples sharing a long prefix collide and return each other's result.
      codeHash: crypto.createHash('sha256').update(options.code).digest('hex'),
      codeLength: options.code.length,
      forceOutput: options.forceOutput,
      includeModuleCode: options.includeModuleCode,
      jsx: options.jsx,
      mangle: options.mangle ?? options.renameVariables,
      mappings: options.mappings,
      maxBundleModules: options.maxBundleModules,
      outputDir: options.outputDir,
      unpack: options.unpack,
      unminify: options.unminify,
    });
    // Cache key only (not an integrity primitive) — sha256 for collision resistance.
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  async deobfuscate(options: DeobfuscateOptions, pool?: WebcrackPool): Promise<DeobfuscateResult> {
    const cacheKey = this.generateCacheKey(options);
    const cached = this.resultCache.get(cacheKey);
    if (cached) {
      logger.debug('Deobfuscation result from cache');
      // Shallow copy: mutating `cached` on the shared object would poison the
      // cache entry for every later caller.
      return { ...cached, cached: true };
    }

    logger.info('Starting webcrack deobfuscation...');
    const startTime = Date.now();

    const obfuscationType = this.detectObfuscationType(options.code);

    const webcrackResult = await runWebcrack(
      options.code,
      {
        unpack: options.unpack,
        unminify: options.unminify,
        jsx: options.jsx,
        mangle: options.mangle ?? options.renameVariables,
        mappings: options.mappings,
        includeModuleCode: options.includeModuleCode,
        maxBundleModules: options.maxBundleModules,
        outputDir: options.outputDir,
        forceOutput: options.forceOutput,
      },
      pool,
    );

    if (!webcrackResult.applied) {
      const reason = webcrackResult.reason ?? 'webcrack did not return a result';
      logger.error(`webcrack deobfuscation failed: ${reason}`);
      throw new Error(reason);
    }

    const analysis = this.buildAnalysis(webcrackResult, obfuscationType);

    const transformations = [
      {
        type: 'webcrack',
        description:
          `Ran webcrack (unminify=${webcrackResult.optionsUsed.unminify}, unpack=` +
          `${webcrackResult.optionsUsed.unpack}, ` +
          `jsx=${webcrackResult.optionsUsed.jsx}, mangle=${webcrackResult.optionsUsed.mangle})`,
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
    // Store a copy so a caller mutating the returned object cannot poison the
    // cache entry for later callers.
    this.resultCache.set(cacheKey, { ...result });

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
