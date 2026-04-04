import { logger } from '@utils/logger';
import type {
  DeobfuscateBundleSummary,
  DeobfuscateMappingRule,
  DeobfuscateSavedArtifact,
} from '@internal-types/deobfuscator';
import { runWebcrack } from '@modules/deobfuscator/webcrack';
import { detectObfuscationType as detectObfuscationTypeUtil } from '@modules/deobfuscator/Deobfuscator.utils';
import crypto from 'crypto';

export interface AdvancedDeobfuscateOptions {
  code: string;
  detectOnly?: boolean;
  aggressiveVM?: boolean;
  useASTOptimization?: boolean;
  timeout?: number;
  unpack?: boolean;
  unminify?: boolean;
  jsx?: boolean;
  mangle?: boolean;
  outputDir?: string;
  forceOutput?: boolean;
  includeModuleCode?: boolean;
  maxBundleModules?: number;
  mappings?: DeobfuscateMappingRule[];
}

export interface AdvancedDeobfuscateResult {
  code: string;
  detectedTechniques: string[];
  confidence: number;
  warnings: string[];
  cached?: boolean;
  astOptimized?: boolean;
  bundle?: DeobfuscateBundleSummary;
  savedTo?: string;
  savedArtifacts?: DeobfuscateSavedArtifact[];
  engine?: 'webcrack';
  webcrackApplied?: boolean;
  vmDetected?: {
    type: string;
    instructions: number;
    deobfuscated: boolean;
  };
}

export class AdvancedDeobfuscator {
  private resultCache = new Map<string, AdvancedDeobfuscateResult>();
  private maxCacheSize = 100;

  private generateCacheKey(options: AdvancedDeobfuscateOptions): string {
    const key = JSON.stringify({
      aggressiveVM: options.aggressiveVM,
      code: options.code.substring(0, 2000),
      detectOnly: options.detectOnly,
      forceOutput: options.forceOutput,
      includeModuleCode: options.includeModuleCode,
      jsx: options.jsx,
      mangle: options.mangle,
      mappings: options.mappings,
      maxBundleModules: options.maxBundleModules,
      outputDir: options.outputDir,
      timeout: options.timeout,
      unpack: options.unpack,
      unminify: options.unminify,
      useASTOptimization: options.useASTOptimization,
    });
    return crypto.createHash('md5').update(key).digest('hex');
  }

  async deobfuscate(options: AdvancedDeobfuscateOptions): Promise<AdvancedDeobfuscateResult> {
    const cacheKey = this.generateCacheKey(options);
    const cached = this.resultCache.get(cacheKey);
    if (cached) {
      logger.debug('Advanced deobfuscation result from cache');
      return { ...cached, cached: true };
    }

    logger.info('Starting advanced webcrack deobfuscation...');

    const detectedTechniques = detectObfuscationTypeUtil(options.code);
    const warnings: string[] = [];

    if (options.aggressiveVM !== undefined) {
      warnings.push(
        'aggressiveVM is deprecated and ignored; VM-specific legacy logic has been removed.',
      );
    }
    if (options.useASTOptimization !== undefined) {
      warnings.push(
        'useASTOptimization is deprecated and ignored; legacy AST post-processing has been removed.',
      );
    }
    if (options.timeout !== undefined) {
      warnings.push('timeout is currently ignored; webcrack controls its own execution flow.');
    }

    if (options.detectOnly) {
      const result: AdvancedDeobfuscateResult = {
        code: options.code,
        detectedTechniques,
        confidence: Math.min(0.6 + detectedTechniques.length * 0.05, 0.9),
        warnings: [
          ...warnings,
          'detectOnly does not invoke a separate legacy detector anymore; techniques are inferred from the current static signature pass.',
        ],
        astOptimized: false,
        engine: 'webcrack',
        webcrackApplied: false,
      };
      this.storeCacheEntry(cacheKey, result);
      return { ...result, cached: false };
    }

    const webcrackResult = await runWebcrack(options.code, {
      unpack: options.unpack,
      unminify: options.unminify,
      jsx: options.jsx,
      mangle: options.mangle,
      mappings: options.mappings,
      includeModuleCode: options.includeModuleCode,
      maxBundleModules: options.maxBundleModules,
      outputDir: options.outputDir,
      forceOutput: options.forceOutput,
    });

    if (!webcrackResult.applied) {
      const reason = webcrackResult.reason ?? 'webcrack did not return a result';
      logger.error(`advanced webcrack deobfuscation failed: ${reason}`);
      throw new Error(reason);
    }

    if (webcrackResult.bundle) {
      detectedTechniques.push('bundle-unpack');
    }
    if (webcrackResult.optionsUsed.unminify) {
      detectedTechniques.push('unminify');
    }
    if (webcrackResult.optionsUsed.jsx) {
      detectedTechniques.push('jsx-decompile');
    }
    if (webcrackResult.optionsUsed.mangle) {
      detectedTechniques.push('mangle');
    }
    detectedTechniques.push('webcrack');

    const result: AdvancedDeobfuscateResult = {
      code: webcrackResult.code,
      detectedTechniques: Array.from(new Set(detectedTechniques)),
      confidence: this.calculateConfidence(webcrackResult, detectedTechniques),
      warnings,
      astOptimized: false,
      bundle: webcrackResult.bundle,
      savedTo: webcrackResult.savedTo,
      savedArtifacts: webcrackResult.savedArtifacts,
      engine: 'webcrack',
      webcrackApplied: true,
    };
    this.storeCacheEntry(cacheKey, result);
    return { ...result, cached: false };
  }

  private storeCacheEntry(cacheKey: string, result: AdvancedDeobfuscateResult): void {
    if (this.resultCache.size >= this.maxCacheSize) {
      const firstKey = this.resultCache.keys().next().value;
      if (firstKey) {
        this.resultCache.delete(firstKey);
      }
    }
    this.resultCache.set(cacheKey, result);
  }

  private calculateConfidence(
    webcrackResult: Awaited<ReturnType<typeof runWebcrack>>,
    detectedTechniques: string[],
  ): number {
    let confidence = 0.72 + detectedTechniques.length * 0.03;

    if (webcrackResult.bundle) {
      confidence += 0.08;
    }
    if (webcrackResult.savedTo) {
      confidence += 0.04;
    }

    return Math.min(confidence, 0.99);
  }
}
