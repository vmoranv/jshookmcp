import { logger } from '@utils/logger';
import {
  detectObfuscationType,
  calculateReadabilityScore,
} from '@modules/deobfuscator/Deobfuscator.utils';
import { runWebcrack } from '@modules/deobfuscator/webcrack';
import { ASTOptimizer } from '@modules/deobfuscator/ASTOptimizer';
import { UniversalUnpacker } from '@modules/deobfuscator/PackerDeobfuscator';
import {
  decodeEscapeSequences,
  normalizeInvisibleUnicode,
  inlineUnescapeAtob,
  derotateStringArray,
  removeDeadCode,
  removeOpaquePredicates,
  decodeStrings,
  applyASTOptimizations,
} from '@modules/deobfuscator/AdvancedDeobfuscator.ast';
import type { ObfuscationType } from '@internal-types/deobfuscator';

export interface PipelineOptions {
  code: string;
  unpack?: boolean;
  unminify?: boolean;
  jsx?: boolean;
  mangle?: boolean;
  timeout?: number;
  outputDir?: string;
  forceOutput?: boolean;
  includeModuleCode?: boolean;
  maxBundleModules?: number;
  skipWebcrack?: boolean;
  skipAST?: boolean;
}

export interface PipelineStepResult {
  stage: string;
  applied: boolean;
  codeLength: number;
  readabilityDelta: number;
  warnings?: string[];
}

export interface PipelineResult {
  code: string;
  originalCode: string;
  readabilityScore: number;
  readabilityScoreBefore: number;
  confidence: number;
  obfuscationTypes: ObfuscationType[];
  steps: PipelineStepResult[];
  warnings: string[];
}

export class DeobfuscationPipeline {
  private readonly astOptimizer = new ASTOptimizer();
  private readonly universalUnpacker = new UniversalUnpacker();

  async run(options: PipelineOptions): Promise<PipelineResult> {
    const startTime = Date.now();
    const originalCode = options.code;
    const obfuscationTypes = detectObfuscationType(originalCode);
    const scoreBefore = calculateReadabilityScore(originalCode);
    const warnings: string[] = [];
    const steps: PipelineStepResult[] = [];

    logger.info(`DeobfuscationPipeline: detected [${obfuscationTypes.join(', ')}]`);

    let current = originalCode;

    current = this.runStep(steps, warnings, 'invisible-unicode', current, () =>
      normalizeInvisibleUnicode(current),
    );

    current = this.runStep(steps, warnings, 'escape-sequences', current, () =>
      decodeEscapeSequences(current),
    );

    current = this.runStep(steps, warnings, 'inline-unescape-atob', current, () =>
      inlineUnescapeAtob(current),
    );

    const unpackResult = await this.universalUnpacker.deobfuscate(current);
    const beforeUnpack = current;
    if (unpackResult.success) {
      current = unpackResult.code;
      steps.push({
        stage: `universal-unpack:${unpackResult.type}`,
        applied: true,
        codeLength: current.length,
        readabilityDelta:
          calculateReadabilityScore(current) - calculateReadabilityScore(beforeUnpack),
      });
    }

    if (options.skipWebcrack !== true) {
      try {
        const webcrackResult = await Promise.race([
          runWebcrack(current, {
            unpack: options.unpack ?? true,
            unminify: options.unminify ?? true,
            jsx: options.jsx ?? true,
            mangle: options.mangle ?? false,
            outputDir: options.outputDir,
            forceOutput: options.forceOutput,
            includeModuleCode: options.includeModuleCode,
            maxBundleModules: options.maxBundleModules,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('webcrack timeout')), options.timeout ?? 30_000),
          ),
        ]);

        if (webcrackResult.applied && webcrackResult.code) {
          const beforeWC = current;
          current = webcrackResult.code;
          steps.push({
            stage: 'webcrack',
            applied: true,
            codeLength: current.length,
            readabilityDelta:
              calculateReadabilityScore(current) - calculateReadabilityScore(beforeWC),
          });
        } else {
          steps.push({
            stage: 'webcrack',
            applied: false,
            codeLength: current.length,
            readabilityDelta: 0,
          });
          if (webcrackResult.reason) warnings.push(`webcrack skipped: ${webcrackResult.reason}`);
        }
      } catch (e) {
        warnings.push(`webcrack error: ${e instanceof Error ? e.message : String(e)}`);
        steps.push({
          stage: 'webcrack',
          applied: false,
          codeLength: current.length,
          readabilityDelta: 0,
        });
      }
    }

    if (options.skipAST !== true) {
      current = this.runStep(steps, warnings, 'derotate-string-array', current, () =>
        derotateStringArray(current),
      );

      current = this.runStep(steps, warnings, 'decode-strings', current, () =>
        decodeStrings(current),
      );

      current = this.runStep(steps, warnings, 'remove-dead-code', current, () =>
        removeDeadCode(current),
      );

      current = this.runStep(steps, warnings, 'remove-opaque-predicates', current, () =>
        removeOpaquePredicates(current),
      );

      current = this.runStep(steps, warnings, 'ast-optimizations', current, () =>
        applyASTOptimizations(current),
      );

      current = this.runStep(steps, warnings, 'ast-optimizer', current, () =>
        this.astOptimizer.optimize(current),
      );
    }

    const scoreAfter = calculateReadabilityScore(current);
    const appliedCount = steps.filter((s) => s.applied).length;
    const confidence = Math.min(0.5 + scoreAfter / 200 + appliedCount * 0.04, 0.99);

    logger.info(
      `DeobfuscationPipeline complete in ${Date.now() - startTime}ms, readability ${scoreBefore} → ${scoreAfter}, confidence ${(confidence * 100).toFixed(1)}%`,
    );

    return {
      code: current,
      originalCode,
      readabilityScore: scoreAfter,
      readabilityScoreBefore: scoreBefore,
      confidence,
      obfuscationTypes,
      steps,
      warnings,
    };
  }

  private runStep(
    steps: PipelineStepResult[],
    warnings: string[],
    stage: string,
    current: string,
    fn: () => string,
  ): string {
    const scoreBefore = calculateReadabilityScore(current);
    try {
      const next = fn();
      const scoreAfter = calculateReadabilityScore(next);
      steps.push({
        stage,
        applied: next !== current,
        codeLength: next.length,
        readabilityDelta: scoreAfter - scoreBefore,
      });
      return next;
    } catch (e) {
      warnings.push(`${stage} failed: ${e instanceof Error ? e.message : String(e)}`);
      steps.push({ stage, applied: false, codeLength: current.length, readabilityDelta: 0 });
      return current;
    }
  }
}
