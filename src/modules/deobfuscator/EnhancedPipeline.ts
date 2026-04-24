import { logger } from '@utils/logger';
import { detectObfuscationType, calculateReadabilityScore } from '@modules/deobfuscator/Deobfuscator.utils';
import { ASTOptimizer } from '@modules/deobfuscator/ASTOptimizer';
import { UniversalUnpacker } from '@modules/deobfuscator/PackerDeobfuscator';
import {
  decodeEscapeSequences,
  normalizeInvisibleUnicode,
  inlineUnescapeAtob,
  derotateStringArray,
  removeDeadCode,
  removeOpaquePredicates,
} from '@modules/deobfuscator/AdvancedDeobfuscator.ast';
import { restoreControlFlowFlattening, detectCFFPattern } from '@modules/deobfuscator/ControlFlowFlattening';
import { restoreStringArrays, detectStringArrayPattern } from '@modules/deobfuscator/StringArrayReconstructor';
import { neutralizeAntiDebug, detectAntiDebugPatterns, detectSelfDefending } from '@modules/deobfuscator/AntiDebugEvasion';
import { advancedConstantPropagation } from '@modules/deobfuscator/ConstantPropagation';
import { removeDeadStores, removeUnreachableCode } from '@modules/deobfuscator/DeadStoreElimination';
import { detectDynamicCodePatterns, detectDynamicImports } from '@modules/deobfuscator/DynamicCodeDetector';
import { fingerprintObfuscator } from '@modules/deobfuscator/ObfuscationFingerprint';
import { detectBundleFormat } from '@modules/deobfuscator/BundleFormatDetector';
import { neutralizeJSDefender, detectJSDefenderPatterns } from '@modules/deobfuscator/JSDefenderDeobfuscator';
import { detectJITSpray, getJITSpraySummary } from '@modules/deobfuscator/JITSprayDetector';
import { detectPolymorphic, getPolymorphicSummary } from '@modules/deobfuscator/PolymorphicDetector';
import { analyzeWASMMixedScheme, getWASMMixedSchemeSummary } from '@modules/deobfuscator/WASMMixedSchemeAnalyzer';
import { VMIntegration, JScramblerIntegration } from '@modules/deobfuscator/VMAndJScramblerIntegration';
import { DeobfuscationMetricsCollector } from '@modules/deobfuscator/DeobfuscationMetrics';
import type { ObfuscationType } from '@internal-types/deobfuscator';

export interface PipelineOptions {
  code: string;
  unpack?: boolean;
  unminify?: boolean;
  jsx?: boolean;
  mangle?: boolean;
  timeout?: number;
  forceOutput?: boolean;
  skipWebcrack?: boolean;
  skipAST?: boolean;
  skipCFF?: boolean;
  skipStringArray?: boolean;
  skipAntiDebug?: boolean;
  skipConstantProp?: boolean;
  skipDeadStore?: boolean;
  skipJSDefender?: boolean;
  skipJITSpray?: boolean;
  skipPolymorphic?: boolean;
  skipWASMMixed?: boolean;
  skipVM?: boolean;
  skipJScrambler?: boolean;
  fingerprint?: boolean;
  detectBundle?: boolean;
  generateSourcemap?: boolean;
  maxRounds?: number;
  maxIterations?: number;
  maxInputSize?: number;
}

export interface PipelineResult {
  code: string;
  originalCode: string;
  readabilityScore: number;
  readabilityScoreBefore: number;
  confidence: number;
  obfuscationTypes: ObfuscationType[];
  fingerprint: { tool: string | null; confidence: number } | null;
  bundleFormat: { format: string; confidence: number } | null;
  jsDefender: { detected: boolean; patterns: string[] } | null;
  jitSpray: { detected: boolean; risk: string } | null;
  polymorphic: { detected: boolean; complexity: string } | null;
  wasmMixed: { detected: boolean; threat: string } | null;
  vm: { detected: boolean; type: string; instructionCount: number } | null;
  jscrambler: { detected: boolean; confidence: number } | null;
  steps: PipelineStepResult[];
  warnings: string[];
  dynamicCode: { type: string; count: number };
  metadata: {
    iterations: number;
    totalRemoved: number;
    totalFolded: number;
    totalInlined: number;
    rounds: number;
    roundResults: RoundResult[];
  };
  sourcemap?: string;
}

export interface PipelineStepResult {
  stage: string;
  applied: boolean;
  codeLength: number;
  readabilityDelta: number;
  count?: number;
  warnings?: string[];
}

export interface RoundResult {
  round: number;
  codeLength: number;
  readabilityScore: number;
  stagesApplied: number;
}

export class EnhancedDeobfuscationPipeline {
  private readonly astOptimizer = new ASTOptimizer();
  private readonly universalUnpacker = new UniversalUnpacker();
  private readonly vmIntegration = new VMIntegration();
  private readonly jscramblerIntegration = new JScramblerIntegration();
  private readonly metrics: DeobfuscationMetricsCollector;
  private readonly detectionCache: Map<string, { types: string[]; timestamp: number }> = new Map();
  private static readonly CACHE_TTL_MS = 30000;

  constructor(enableMetrics: boolean = false) {
    this.metrics = enableMetrics ? new DeobfuscationMetricsCollector() : new DeobfuscationMetricsCollector();
  }

  private getCachedDetection(code: string): ObfuscationType[] | null {
    const cacheKey = code.slice(0, 500);
    const cached = this.detectionCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < EnhancedDeobfuscationPipeline.CACHE_TTL_MS) {
      return cached.types as ObfuscationType[];
    }
    return null;
  }

  private setCachedDetection(code: string, types: ObfuscationType[]): void {
    const cacheKey = code.slice(0, 500);
    this.detectionCache.set(cacheKey, { types: types as string[], timestamp: Date.now() });
    if (this.detectionCache.size > 100) {
      const oldestKey = this.detectionCache.keys().next().value;
      if (oldestKey) this.detectionCache.delete(oldestKey);
    }
  }

  async run(options: PipelineOptions): Promise<PipelineResult> {
    const startTime = Date.now();
    let originalCode = options.code;
    const maxInputSize = options.maxInputSize ?? (5 * 1024 * 1024);
    const warnings: string[] = [];

    if (originalCode.length > maxInputSize) {
      logger.warn(`EnhancedPipeline: input size ${originalCode.length} exceeds max ${maxInputSize}, truncating`);
      originalCode = originalCode.slice(0, maxInputSize);
      warnings.push(`Input truncated from ${options.code.length} to ${maxInputSize} bytes`);
    }

    if (originalCode.length === 0) {
      logger.warn('EnhancedPipeline: empty input code');
    }

    let obfuscationTypes: ObfuscationType[];
    const cachedTypes = this.getCachedDetection(originalCode);
    if (cachedTypes) {
      obfuscationTypes = cachedTypes;
    } else {
      obfuscationTypes = detectObfuscationType(originalCode);
      this.setCachedDetection(originalCode, obfuscationTypes);
    }
    const scoreBefore = calculateReadabilityScore(originalCode);
    const allSteps: PipelineStepResult[] = [];
    const roundResults: RoundResult[] = [];

    this.metrics.startRun(originalCode.length);
    this.metrics.recordObfuscationTypes(obfuscationTypes);

    logger.info(`EnhancedPipeline: detected [${obfuscationTypes.join(', ')}]`);

    const fingerprint = options.fingerprint !== false ? fingerprintObfuscator(originalCode) : null;
    const bundleFormat = options.detectBundle !== false ? detectBundleFormat(originalCode) : null;

    const dynamicCodeDetections = detectDynamicCodePatterns(originalCode);
    const dynamicImports = detectDynamicImports(originalCode);

    const maxRounds = options.maxRounds ?? 3;
    const maxIterations = (options.maxIterations ?? 50);
    let current = originalCode;
    let rounds = 0;
    let totalRemoved = 0;
    let totalFolded = 0;
    let totalInlined = 0;
    let iterations = 0;
    let prevLength = current.length + 1;
    let prevHash = '';

    const computeHash = (code: string): string => {
      let hash = 0;
      for (let i = 0; i < Math.min(code.length, 1000); i++) {
        hash = ((hash << 5) - hash) + code.charCodeAt(i);
        hash = hash & hash;
      }
      return String(hash);
    };

    while (rounds < maxRounds && current.length < prevLength && iterations < maxIterations) {
      iterations++;
      prevLength = current.length;
      const currentHash = computeHash(current);
      if (currentHash === prevHash && rounds > 0) {
        logger.debug('EnhancedPipeline: code hash unchanged, stopping rounds');
        break;
      }
      prevHash = currentHash;
      rounds++;

      const roundSteps: PipelineStepResult[] = [];

      current = await this.runRound(options, roundSteps, warnings, current);

      const roundStagesApplied = roundSteps.filter((s) => s.applied).length;
      const roundScoreAfter = calculateReadabilityScore(current);

      roundResults.push({
        round: rounds,
        codeLength: current.length,
        readabilityScore: roundScoreAfter,
        stagesApplied: roundStagesApplied,
      });

      for (const step of roundSteps) {
        allSteps.push(step);
      }
    }

    const scoreAfter = calculateReadabilityScore(current);
    const appliedCount = allSteps.filter((s) => s.applied).length;
    const confidence = Math.min(0.5 + (scoreAfter / 200) + (appliedCount * 0.04), 0.99);

    logger.info(
      `EnhancedPipeline complete in ${Date.now() - startTime}ms, ${rounds} rounds, readability ${scoreBefore} → ${scoreAfter}, confidence ${(confidence * 100).toFixed(1)}%`,
    );

    let sourcemap: string | undefined;
    if (options.generateSourcemap) {
      try {
        const { createSourcemapForTransformation } = await import('@modules/deobfuscator/SourcemapGenerator');
        const smResult = createSourcemapForTransformation(originalCode, current, { source: 'original.js' });
        sourcemap = smResult.sourcemap;
        logger.info(`EnhancedPipeline: generated sourcemap (${smResult.sourcemap.length} bytes)`);
      } catch (e) {
        warnings.push(`sourcemap generation failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const jsDefResult = detectJSDefenderPatterns(originalCode);
    const jitResult = detectJITSpray(originalCode);
    const polyResult = detectPolymorphic(originalCode);
    const wasmResult = analyzeWASMMixedScheme(originalCode);
    const vmDetection = this.vmIntegration.detectVM(originalCode);
    const jscramblerDetection = this.jscramblerIntegration.detectJScrambler(originalCode)
      ? { detected: true, confidence: 0.6 }
      : null;

    this.metrics.endRun(true, current.length);

    return {
      code: current,
      originalCode,
      readabilityScore: scoreAfter,
      readabilityScoreBefore: scoreBefore,
      confidence,
      obfuscationTypes,
      fingerprint: fingerprint ? { tool: fingerprint.tool, confidence: fingerprint.confidence } : null,
      bundleFormat: bundleFormat ? { format: bundleFormat.format, confidence: bundleFormat.confidence } : null,
      jsDefender: jsDefResult.length > 0 ? { detected: true, patterns: jsDefResult.map((r) => r.pattern) } : null,
      jitSpray: jitResult.detected ? { detected: true, risk: getJITSpraySummary(originalCode).risk } : null,
      polymorphic: polyResult.detected ? { detected: true, complexity: getPolymorphicSummary(originalCode).complexity } : null,
      wasmMixed: wasmResult.detected ? { detected: true, threat: getWASMMixedSchemeSummary(originalCode).threat } : null,
      vm: vmDetection.detected ? { detected: true, type: vmDetection.type, instructionCount: vmDetection.instructionCount } : null,
      jscrambler: jscramblerDetection,
      steps: allSteps,
      warnings,
      dynamicCode: {
        type: dynamicImports.length > 0 ? 'imports' : dynamicCodeDetections.length > 0 ? 'eval' : 'none',
        count: dynamicImports.length || dynamicCodeDetections.length,
      },
      metadata: {
        iterations,
        totalRemoved,
        totalFolded,
        totalInlined,
        rounds,
        roundResults,
      },
      sourcemap,
    };
  }

  private async runRound(
    options: PipelineOptions,
    steps: PipelineStepResult[],
    warnings: string[],
    code: string,
  ): Promise<string> {
    let current = code;

    current = this.runStep(steps, warnings, 'invisible-unicode', current, () =>
      normalizeInvisibleUnicode(current),
    );

    current = this.runStep(steps, warnings, 'escape-sequences', current, () =>
      decodeEscapeSequences(current),
    );

    current = this.runStep(steps, warnings, 'inline-unescape-atob', current, () =>
      inlineUnescapeAtob(current),
    );

    if (!options.skipCFF) {
      if (detectCFFPattern(current)) {
        const cffResult = restoreControlFlowFlattening(current);
        if (cffResult.restored > 0) {
          current = this.runStep(steps, warnings, 'control-flow-flattening', current, () => cffResult.code, cffResult.restored);
          warnings.push(...cffResult.warnings);
        }
      }
    }

    if (options.unpack !== false) {
      const unpackResult = await this.universalUnpacker.deobfuscate(current);
      if (unpackResult.success) {
        current = this.runStep(steps, warnings, 'unpack', current, () => unpackResult.code);
      }
    }

    if (!options.skipStringArray) {
      if (detectStringArrayPattern(current)) {
        const saResult = restoreStringArrays(current);
        if (saResult.restored > 0) {
          current = this.runStep(steps, warnings, 'string-array', current, () => saResult.code, saResult.restored);
          warnings.push(...saResult.warnings);
        }
      }
    }

    current = this.runStep(steps, warnings, 'string-derotation', current, () =>
      derotateStringArray(current),
    );

    current = this.runStep(steps, warnings, 'opaque-predicates', current, () =>
      removeOpaquePredicates(current),
    );

    current = this.runStep(steps, warnings, 'dead-code', current, () => removeDeadCode(current));

    if (!options.skipAntiDebug) {
      if (detectAntiDebugPatterns(current).length > 0 || detectSelfDefending(current)) {
        const adResult = neutralizeAntiDebug(current);
        if (adResult.removed > 0) {
          current = this.runStep(steps, warnings, 'anti-debug', current, () => adResult.code, adResult.removed);
          warnings.push(...adResult.warnings);
        }
      }
    }

    if (!options.skipConstantProp) {
      const cpResult = advancedConstantPropagation(current);
      if (cpResult.folded > 0 || cpResult.inlined > 0) {
        current = this.runStep(steps, warnings, 'constant-propagation', current, () => cpResult.code, undefined, cpResult.folded + cpResult.inlined);
        warnings.push(...cpResult.warnings);
      }
    }

    if (!options.skipDeadStore) {
      const dsResult = removeDeadStores(current);
      if (dsResult.removed > 0) {
        current = this.runStep(steps, warnings, 'dead-store', current, () => dsResult.code, dsResult.removed);
        warnings.push(...dsResult.warnings);
      }

      const urResult = removeUnreachableCode(current);
      if (urResult.removed > 0) {
        current = this.runStep(steps, warnings, 'unreachable-code', current, () => urResult.code, urResult.removed);
        warnings.push(...urResult.warnings);
      }
    }

    if (!options.skipJSDefender) {
      const jsDefPatterns = detectJSDefenderPatterns(current);
      if (jsDefPatterns.length > 0) {
        const jsDefResult = await neutralizeJSDefender(current);
        if (jsDefResult.removed > 0) {
          current = this.runStep(steps, warnings, 'jsdefender', current, () => jsDefResult.code, jsDefResult.removed);
          warnings.push(...jsDefResult.warnings);
        }
      }
    }

    if (!options.skipJITSpray) {
      const jitResult = detectJITSpray(current);
      if (jitResult.detected) {
        warnings.push(...jitResult.warnings);
        this.runStep(steps, warnings, 'jit-spray-detect', current, () => current);
      }
    }

    if (!options.skipPolymorphic) {
      const polyResult = detectPolymorphic(current);
      if (polyResult.detected) {
        warnings.push(...polyResult.warnings);
        this.runStep(steps, warnings, 'polymorphic-detect', current, () => current);
      }
    }

    if (!options.skipWASMMixed) {
      const wasmResult = analyzeWASMMixedScheme(current);
      if (wasmResult.detected) {
        warnings.push(...wasmResult.warnings);
        this.runStep(steps, warnings, 'wasm-mixed-detect', current, () => current);
      }
    }

    if (!options.skipVM) {
      const vmResult = this.vmIntegration.detectVM(current);
      if (vmResult.detected) {
        warnings.push(...vmResult.warnings);
        this.runStep(steps, warnings, 'vm-detect', current, () => current);
      }
    }

    if (!options.skipJScrambler) {
      if (this.jscramblerIntegration.detectJScrambler(current)) {
        warnings.push('JScrambler pattern detected');
        this.runStep(steps, warnings, 'jscrambler-detect', current, () => current);
      }
    }

    if (!options.skipAST) {
      for (let i = 0; i < 4; i++) {
        const beforeAST = current;
        current = this.astOptimizer.optimize(current);
        if (current === beforeAST) break;
      }
      this.runStep(steps, warnings, 'ast-optimization', code, () => current);
    }

    return current;
  }

  async runBatch(options: PipelineOptions[]): Promise<PipelineResult[]> {
    const results = await Promise.all(options.map((opts) => this.run(opts)));
    return results;
  }

  private runStep(
    steps: PipelineStepResult[],
    warnings: string[],
    stage: string,
    current: string,
    fn: () => string,
    count?: number,
    _folded?: number,
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
        count,
      });
      return next;
    } catch (e) {
      warnings.push(`${stage} failed: ${e instanceof Error ? e.message : String(e)}`);
      steps.push({ stage, applied: false, codeLength: current.length, readabilityDelta: 0 });
      return current;
    }
  }
}
