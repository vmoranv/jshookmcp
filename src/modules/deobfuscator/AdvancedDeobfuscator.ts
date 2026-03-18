import { logger } from '@utils/logger';
import type {
  DeobfuscateBundleSummary,
  DeobfuscateMappingRule,
  DeobfuscateSavedArtifact,
} from '@internal-types/deobfuscator';
import { runWebcrack } from '@modules/deobfuscator/webcrack';
import { detectObfuscationType as detectObfuscationTypeUtil } from '@modules/deobfuscator/Deobfuscator.utils';

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
  async deobfuscate(options: AdvancedDeobfuscateOptions): Promise<AdvancedDeobfuscateResult> {
    logger.info('Starting advanced webcrack deobfuscation...');

    const detectedTechniques = detectObfuscationTypeUtil(options.code);
    const warnings: string[] = [];

    if (options.aggressiveVM !== undefined) {
      warnings.push(
        'aggressiveVM is deprecated and ignored; VM-specific legacy logic has been removed.'
      );
    }
    if (options.useASTOptimization !== undefined) {
      warnings.push(
        'useASTOptimization is deprecated and ignored; legacy AST post-processing has been removed.'
      );
    }
    if (options.timeout !== undefined) {
      warnings.push('timeout is currently ignored; webcrack controls its own execution flow.');
    }

    if (options.detectOnly) {
      return {
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

    return {
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
  }

  private calculateConfidence(
    webcrackResult: Awaited<ReturnType<typeof runWebcrack>>,
    detectedTechniques: string[]
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
