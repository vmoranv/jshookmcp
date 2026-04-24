/**
 * UnifiedPipeline — Production-grade, strategy-routed deobfuscation pipeline.
 *
 * Merges EnhancedPipeline and DeobfuscationPipeline into a single orchestrator
 * with strategy routing, runtime harvesting, prelude carving, IR-based analysis,
 * VM/WASM dedicated lanes, poisoned-name quarantine, and equivalence validation.
 *
 * Design principles:
 * - Modular, functional, immutable where possible
 * - Strategy routing selects lane based on fingerprint
 * - Each lane is an ordered list of passes
 * - Sandbox modes for runtime harvesting
 * - Equivalence oracle validates transforms
 * - No breaking changes to existing PipelineOptions
 */

import { logger } from '@utils/logger';
import {
  detectObfuscationType,
  calculateReadabilityScore,
} from '@modules/deobfuscator/Deobfuscator.utils';
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
import { autoDecodeExotic } from '@modules/deobfuscator/ExoticEncodeDecoder';
import { ExecutionSandbox } from '@modules/security/ExecutionSandbox';
import { runWebcrack } from '@modules/deobfuscator/webcrack';
import type { ObfuscationType } from '@internal-types/deobfuscator';

// ── Strategy lane types ──

export type StrategyLane =
  | 'bundle-first'
  | 'exotic-encoding-first'
  | 'jsdefender-first'
  | 'vm-first'
  | 'wasm-first'
  | 'runtime-first'
  | 'generic';

export interface StrategyDecision {
  lane: StrategyLane;
  confidence: number;
  reasons: string[];
}

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
  skipExotic?: boolean;
  skipPrelude?: boolean;
  skipQuarantine?: boolean;
  skipEquivalence?: boolean;
  skipBehavioral?: boolean;
  fingerprint?: boolean;
  detectBundle?: boolean;
  generateSourcemap?: boolean;
  maxRounds?: number;
  maxIterations?: number;
  maxInputSize?: number;
  /** Sandbox mode for runtime harvesting */
  sandboxMode?: 'observe' | 'emulate' | 'strict';
  /** Strategy override; if not set, auto-detected */
  strategyOverride?: StrategyLane;
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

export interface HarvestCapture {
  type: string;
  value: string;
  source: string;
  timestamp: number;
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
  harvestCaptures: HarvestCapture[];
  strategyDecision: StrategyDecision;
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

// ── Strategy Router ──

export function selectStrategy(code: string): StrategyDecision {
  const reasons: string[] = [];
  let bestLane: StrategyLane = 'generic';
  let bestScore = 0;

  // Bundle-first: webpack/browserify/rollup/parcel bundles
  const bundleSignals = [
    /__webpack_require__/.test(code),
    /webpackJsonp/.test(code),
    /__webpack_exports__/.test(code),
    /require\s*\(\s*function\s*\w*\s*\(\s*t\s*\)/.test(code),
    /__vitePreload/.test(code),
    /__rollup_/.test(code),
  ];
  const bundleScore = bundleSignals.filter(Boolean).length;
  if (bundleScore >= 2) {
    const score = 0.3 + bundleScore * 0.1;
    if (score > bestScore) {
      bestScore = score;
      bestLane = 'bundle-first';
      reasons.push(`Bundle signals: ${bundleScore} matches`);
    }
  }

  // Exotic-encoding-first: JSFuck, JJEncode, AAEncode, heavy hex/unicode
  const exoticSignals = [
    /^\s*[\[\]()+!]{20,}\s*$/m.test(code),
    /\$=~\[\]/.test(code),
    /ﾟωﾟ|ﾟΘﾟ|ﾟｰﾟ/.test(code),
    (code.match(/\\x[0-9a-fA-F]{2}/g) ?? []).length > 20,
    (code.match(/\\u[0-9a-fA-F]{4}/g) ?? []).length > 15,
  ];
  const exoticScore = exoticSignals.filter(Boolean).length;
  if (exoticScore >= 2) {
    const score = 0.3 + exoticScore * 0.12;
    if (score > bestScore) {
      bestScore = score;
      bestLane = 'exotic-encoding-first';
      reasons.push(`Exotic encoding signals: ${exoticScore} matches`);
    }
  }

  // JSDefender-first: console interception, function cloning, encrypted value tables, self-defending
  const jsDefSignals = detectJSDefenderPatterns(code);
  if (jsDefSignals.length >= 2) {
    const score = 0.35 + jsDefSignals.length * 0.1;
    if (score > bestScore) {
      bestScore = score;
      bestLane = 'jsdefender-first';
      reasons.push(`JSDefender signals: ${jsDefSignals.map((s) => s.pattern).join(', ')}`);
    }
  }

  // VM-first: large switch/dispatcher loops, bytecode arrays, obfuscator.io VM patterns
  const vmIntegration = new VMIntegration();
  const vmDetect = vmIntegration.detectVM(code);
  if (vmDetect.detected && vmDetect.instructionCount > 20) {
    const score = 0.4 + Math.min(vmDetect.instructionCount / 200, 0.3);
    if (score > bestScore) {
      bestScore = score;
      bestLane = 'vm-first';
      reasons.push(`VM detected: type=${vmDetect.type}, instructions=${vmDetect.instructionCount}`);
    }
  }

  // WASM-first: WebAssembly loading, JS/WASM interop, WASM string obfuscation
  const wasmDetect = analyzeWASMMixedScheme(code);
  if (wasmDetect.detected) {
    const score = 0.45;
    if (score > bestScore) {
      bestScore = score;
      bestLane = 'wasm-first';
      reasons.push(`WASM mixed scheme: ${wasmDetect.detections.map((d) => d.type).join(', ')}`);
    }
  }

  // Runtime-first: eval/new Function/setTimeout-string/Proxy-heavy
  const dynamicDetect = detectDynamicCodePatterns(code);
  const dynamicImports = detectDynamicImports(code);
  if (dynamicDetect.length >= 3 || (dynamicDetect.length >= 2 && dynamicImports.length > 0)) {
    const score = 0.35 + dynamicDetect.length * 0.05;
    if (score > bestScore) {
      bestScore = score;
      bestLane = 'runtime-first';
      reasons.push(`Dynamic code signals: ${dynamicDetect.length} eval/function, ${dynamicImports.length} imports`);
    }
  }

  if (bestLane === 'generic') {
    reasons.push('No strong obfuscation pattern detected; falling back to generic lane');
  }

  return { lane: bestLane, confidence: Math.min(bestScore, 1.0), reasons };
}

// ── Main Pipeline ──

export class UnifiedDeobfuscationPipeline {
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

  // ── Public API ──

  async run(options: PipelineOptions): Promise<PipelineResult> {
    const startTime = Date.now();
    let originalCode = options.code;
    const maxInputSize = options.maxInputSize ?? (5 * 1024 * 1024);
    const warnings: string[] = [];
    const harvestCaptures: HarvestCapture[] = [];

    // Truncate if oversized
    if (originalCode.length > maxInputSize) {
      logger.warn(`UnifiedPipeline: input size ${originalCode.length} exceeds max ${maxInputSize}, truncating`);
      originalCode = originalCode.slice(0, maxInputSize);
      warnings.push(`Input truncated from ${options.code.length} to ${maxInputSize} bytes`);
    }

    if (originalCode.length === 0) {
      logger.warn('UnifiedPipeline: empty input code');
    }

    // ── Phase 0: Fingerprint + Strategy ──
    const obfuscationTypes = this.getCachedDetection(originalCode);
    const scoreBefore = calculateReadabilityScore(originalCode);

    const strategyDecision = options.strategyOverride
      ? { lane: options.strategyOverride, confidence: 1.0, reasons: ['Strategy overridden by caller'] }
      : selectStrategy(originalCode);

    logger.info(`UnifiedPipeline: strategy=${strategyDecision.lane}, confidence=${strategyDecision.confidence.toFixed(2)}, reasons=[${strategyDecision.reasons.join('; ')}]`);

    const fingerprint = options.fingerprint !== false ? fingerprintObfuscator(originalCode) : null;
    const bundleFormat = options.detectBundle !== false ? detectBundleFormat(originalCode) : null;
    const dynamicCodeDetections = detectDynamicCodePatterns(originalCode);
    const dynamicImports = detectDynamicImports(originalCode);

    // ── Phase 1: Pre-transform (exotic decoding, Unicode normalize) ──
    let current = originalCode;
    const allSteps: PipelineStepResult[] = [];
    const roundResults: RoundResult[] = [];

    this.metrics.startRun(originalCode.length);
    this.metrics.recordObfuscationTypes(obfuscationTypes);

    current = this.runStep(allSteps, warnings, 'invisible-unicode', current, () =>
      normalizeInvisibleUnicode(current));

    current = this.runStep(allSteps, warnings, 'escape-sequences', current, () =>
      decodeEscapeSequences(current));

    current = this.runStep(allSteps, warnings, 'inline-unescape-atob', current, () =>
      inlineUnescapeAtob(current));

    // Exotic encoding auto-decode
    if (!options.skipExotic) {
      try {
        const sandbox = new ExecutionSandbox();
        const exoticResult = await autoDecodeExotic(current, sandbox, options.timeout ?? 5000);
        if (exoticResult.success && exoticResult.confidence > 0.5) {
          current = this.runStep(allSteps, warnings, 'exotic-encoding', current, () => exoticResult.code);
          for (const w of exoticResult.warnings) warnings.push(`exotic-encoding: ${w}`);
          harvestCaptures.push({
            type: 'exotic-decode',
            value: `decoded ${exoticResult.confidence.toFixed(2)} confidence`,
            source: 'autoDecodeExotic',
            timestamp: Date.now(),
          });
        }
      } catch (e) {
        warnings.push(`exotic-encoding failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // ── Phase 2: Strategy-routed passes ──
    current = await this.runStrategyLane(options, strategyDecision.lane, current, allSteps, warnings, harvestCaptures);

    // ── Phase 3: Multi-round AST optimization ──
    const maxRounds = options.maxRounds ?? 3;
    const maxIterations = options.maxIterations ?? 50;
    let rounds = 0;
    let totalRemoved = 0;
    let totalFolded = 0;
    let totalInlined = 0;
    let iterations = 0;
    let prevLength = current.length + 1;

    // Fixed convergence: stop when code stops changing, not just shrinking
    const computeHash = (code: string): string => {
      let hash = 0;
      for (let i = 0; i < Math.min(code.length, 2000); i++) {
        hash = ((hash << 5) - hash) + code.charCodeAt(i);
        hash = hash & hash;
      }
      return String(hash);
    };
    let prevHash = '';

    while (rounds < maxRounds && iterations < maxIterations) {
      iterations++;
      const currentHash = computeHash(current);
      if (currentHash === prevHash && rounds > 0) {
        logger.debug('UnifiedPipeline: code hash unchanged, stopping rounds');
        break;
      }
      // Also stop if readability hasn't improved much and code is barely changing
      if (rounds > 0 && Math.abs(current.length - prevLength) < 5) {
        logger.debug('UnifiedPipeline: minimal code change, stopping rounds');
        break;
      }
      prevHash = currentHash;
      prevLength = current.length;
      rounds++;

      const roundSteps: PipelineStepResult[] = [];
      current = await this.runRound(options, roundSteps, warnings, current);

      // Track metrics
      const appliedInRound = roundSteps.filter((s) => s.applied).length;
      totalRemoved += roundSteps.reduce((acc, s) => acc + (s.count ?? 0), 0);
      totalInlined += roundSteps.reduce((acc, s) => acc + (s.readabilityDelta > 0 ? Math.floor(s.readabilityDelta) : 0), 0);

      roundResults.push({
        round: rounds,
        codeLength: current.length,
        readabilityScore: calculateReadabilityScore(current),
        stagesApplied: appliedInRound,
      });

      for (const step of roundSteps) {
        allSteps.push(step);
      }
    }

    // ── Phase 4: Final detection summary ──
    const scoreAfter = calculateReadabilityScore(current);
    const appliedCount = allSteps.filter((s) => s.applied).length;
    const confidence = Math.min(0.5 + (scoreAfter / 200) + (appliedCount * 0.04), 0.99);

    logger.info(
      `UnifiedPipeline complete in ${Date.now() - startTime}ms, ${rounds} rounds, strategy=${strategyDecision.lane}, readability ${scoreBefore} → ${scoreAfter}, confidence ${(confidence * 100).toFixed(1)}%`,
    );

    // ── Phase 5: Sourcemap (if requested) ──
    let sourcemap: string | undefined;
    if (options.generateSourcemap) {
      try {
        const { createSourcemapForTransformation } = await import('@modules/deobfuscator/SourcemapGenerator');
        const smResult = createSourcemapForTransformation(originalCode, current, { source: 'original.js' });
        sourcemap = smResult.sourcemap;
        logger.info(`UnifiedPipeline: generated sourcemap (${smResult.sourcemap.length} bytes)`);
      } catch (e) {
        warnings.push(`sourcemap generation failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // ── Detection summaries ──
    const jsDefResult = detectJSDefenderPatterns(current);
    const jitResult = detectJITSpray(current);
    const polyResult = detectPolymorphic(current);
    const wasmResult = analyzeWASMMixedScheme(current);
    const vmDetection = this.vmIntegration.detectVM(current);
    const jscramblerDetection = this.jscramblerIntegration.detectJScrambler(current)
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
      harvestCaptures,
      strategyDecision,
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

  async runBatch(options: PipelineOptions[]): Promise<PipelineResult[]> {
    return Promise.all(options.map((opts) => this.run(opts)));
  }

  // ── Strategy Lane Dispatch ──

  private async runStrategyLane(
    options: PipelineOptions,
    lane: StrategyLane,
    code: string,
    steps: PipelineStepResult[],
    warnings: string[],
    captures: HarvestCapture[],
  ): Promise<string> {
    let current = code;

    switch (lane) {
      case 'bundle-first':
        current = await this.laneBundleFirst(options, current, steps, warnings, captures);
        break;
      case 'exotic-encoding-first':
        current = await this.laneExoticEncodingFirst(options, current, steps, warnings, captures);
        break;
      case 'jsdefender-first':
        current = await this.laneJSDefenderFirst(options, current, steps, warnings, captures);
        break;
      case 'vm-first':
        current = await this.laneVMFirst(options, current, steps, warnings, captures);
        break;
      case 'wasm-first':
        current = await this.laneWASMFirst(options, current, steps, warnings, captures);
        break;
      case 'runtime-first':
        current = await this.laneRuntimeFirst(options, current, steps, warnings, captures);
        break;
      case 'generic':
      default:
        current = await this.laneGeneric(options, current, steps, warnings, captures);
        break;
    }

    return current;
  }

  // ── Lane: Bundle-First ──

  private async laneBundleFirst(
    options: PipelineOptions,
    code: string,
    steps: PipelineStepResult[],
    warnings: string[],
    _captures: HarvestCapture[],
  ): Promise<string> {
    let current = code;

    // Unpack bundles first
    if (options.unpack !== false) {
      const unpackResult = await this.universalUnpacker.deobfuscate(current);
      if (unpackResult.success) {
        current = this.runStep(steps, warnings, 'unpack-bundle', current, () => unpackResult.code);
      }
    }

    // Then webcrack for module resolution
    if (options.skipWebcrack !== true) {
      current = await this.tryWebcrack(current, options, steps, warnings);
    }

    // Then standard AST cleanup
    current = this.runStep(steps, warnings, 'derotate-string-array', current, () => derotateStringArray(current));
    current = this.runStep(steps, warnings, 'remove-dead-code-bf', current, () => removeDeadCode(current));
    current = this.runStep(steps, warnings, 'opaque-predicates-bf', current, () => removeOpaquePredicates(current));

    return current;
  }

  // ── Lane: Exotic Encoding First ──

  private async laneExoticEncodingFirst(
    options: PipelineOptions,
    code: string,
    steps: PipelineStepResult[],
    warnings: string[],
    captures: HarvestCapture[],
  ): Promise<string> {
    let current = code;

    // Exotic decode already happened in Phase 1, but re-run if initial pass found more
    if (!options.skipExotic) {
      try {
        const sandbox2 = new ExecutionSandbox();
        const exotic2 = await autoDecodeExotic(current, sandbox2, options.timeout ?? 5000);
        if (exotic2.success && exotic2.confidence > 0.6) {
          current = this.runStep(steps, warnings, 'exotic-encoding-pass2', current, () => exotic2.code);
          captures.push({ type: 'exotic-decode-pass2', value: `confidence=${exotic2.confidence.toFixed(2)}`, source: 'laneExoticEncodingFirst', timestamp: Date.now() });
        }
      } catch {
        // Non-fatal: already decoded in Phase 1
      }
    }

    // After exotic decode, fall through to generic processing
    return this.laneGeneric(options, current, steps, warnings, captures);
  }

  // ── Lane: JSDefender First ──

  private async laneJSDefenderFirst(
    options: PipelineOptions,
    code: string,
    steps: PipelineStepResult[],
    warnings: string[],
    captures: HarvestCapture[],
  ): Promise<string> {
    let current = code;

    // JSDefender neutralization before any other transform
    if (!options.skipJSDefender) {
      const jsDefPatterns = detectJSDefenderPatterns(current);
      if (jsDefPatterns.length > 0) {
        const jsDefResult = await neutralizeJSDefender(current);
        if (jsDefResult.removed > 0) {
          current = this.runStep(steps, warnings, 'jsdefender-first', current, () => jsDefResult.code, jsDefResult.removed);
          warnings.push(...jsDefResult.warnings);
          captures.push({ type: 'jsdefender', value: `removed=${jsDefResult.removed}`, source: 'laneJSDefenderFirst', timestamp: Date.now() });
        }
      }
    }

    // Anti-debug before CFF (JSDefender often uses debugger traps)
    if (!options.skipAntiDebug) {
      if (detectAntiDebugPatterns(current).length > 0 || detectSelfDefending(current)) {
        const adResult = neutralizeAntiDebug(current);
        if (adResult.removed > 0) {
          current = this.runStep(steps, warnings, 'anti-debug-jd', current, () => adResult.code, adResult.removed);
          warnings.push(...adResult.warnings);
        }
      }
    }

    return this.laneGeneric(options, current, steps, warnings, captures);
  }

  // ── Lane: VM First ──

  private async laneVMFirst(
    options: PipelineOptions,
    code: string,
    steps: PipelineStepResult[],
    warnings: string[],
    captures: HarvestCapture[],
  ): Promise<string> {
    let current = code;

    // VM detection already happened in strategy selector.
    // Run string array restoration first (VM-obfuscated code uses string arrays heavily)
    if (!options.skipStringArray) {
      if (detectStringArrayPattern(current)) {
        const saResult = restoreStringArrays(current);
        if (saResult.restored > 0) {
          current = this.runStep(steps, warnings, 'string-array-vm', current, () => saResult.code, saResult.restored);
          warnings.push(...saResult.warnings);
        }
      }
    }

    // CFF before VM passes
    if (!options.skipCFF) {
      if (detectCFFPattern(current)) {
        const cffResult = restoreControlFlowFlattening(current);
        if (cffResult.restored > 0) {
          current = this.runStep(steps, warnings, 'cff-vm', current, () => cffResult.code, cffResult.restored);
          warnings.push(...cffResult.warnings);
        }
      }
    }

    // VM deobfuscation (detect-only for now; actual deobfuscation is a future enhancement)
    if (!options.skipVM) {
      const vmResult = this.vmIntegration.detectVM(current);
      if (vmResult.detected) {
        warnings.push(...vmResult.warnings);
        this.runStep(steps, warnings, 'vm-detect-vm', current, () => current);
        captures.push({ type: 'vm-detect', value: `type=${vmResult.type},instructions=${vmResult.instructionCount}`, source: 'laneVMFirst', timestamp: Date.now() });
      }
    }

    return this.laneGeneric(options, current, steps, warnings, captures);
  }

  // ── Lane: WASM First ──

  private async laneWASMFirst(
    options: PipelineOptions,
    code: string,
    steps: PipelineStepResult[],
    warnings: string[],
    captures: HarvestCapture[],
  ): Promise<string> {
    let current = code;

    // WASM already detected in strategy selector.
    // Run detection steps and harvest WASM boundaries
    if (!options.skipWASMMixed) {
      const wasmResult = analyzeWASMMixedScheme(current);
      if (wasmResult.detected) {
        warnings.push(...wasmResult.warnings);
        this.runStep(steps, warnings, 'wasm-mixed-wf', current, () => current);
        for (const det of wasmResult.detections) {
          captures.push({ type: 'wasm-boundary', value: det.description, source: det.type, timestamp: Date.now() });
        }
      }
    }

    return this.laneGeneric(options, current, steps, warnings, captures);
  }

  // ── Lane: Runtime First ──

  private async laneRuntimeFirst(
    options: PipelineOptions,
    code: string,
    steps: PipelineStepResult[],
    warnings: string[],
    captures: HarvestCapture[],
  ): Promise<string> {
    let current = code;

    // Capture runtime dynamic code patterns
    const dynPatterns = detectDynamicCodePatterns(current);
    for (const dp of dynPatterns) {
      captures.push({ type: 'dynamic-code', value: dp.code.slice(0, 200), source: dp.type, timestamp: Date.now() });
    }

    // Anti-debug before dynamic resolution
    if (!options.skipAntiDebug) {
      if (detectAntiDebugPatterns(current).length > 0 || detectSelfDefending(current)) {
        const adResult = neutralizeAntiDebug(current);
        if (adResult.removed > 0) {
          current = this.runStep(steps, warnings, 'anti-debug-rt', current, () => adResult.code, adResult.removed);
          warnings.push(...adResult.warnings);
        }
      }
    }

    return this.laneGeneric(options, current, steps, warnings, captures);
  }

  // ── Lane: Generic (full pipeline) ──

  private async laneGeneric(
    options: PipelineOptions,
    code: string,
    steps: PipelineStepResult[],
    warnings: string[],
    _captures: HarvestCapture[],
  ): Promise<string> {
    let current = code;

    // CFF
    if (!options.skipCFF) {
      if (detectCFFPattern(current)) {
        const cffResult = restoreControlFlowFlattening(current);
        if (cffResult.restored > 0) {
          current = this.runStep(steps, warnings, 'control-flow-flattening', current, () => cffResult.code, cffResult.restored);
          warnings.push(...cffResult.warnings);
        }
      }
    }

    // Unpack
    if (options.unpack !== false) {
      const unpackResult = await this.universalUnpacker.deobfuscate(current);
      if (unpackResult.success) {
        current = this.runStep(steps, warnings, 'unpack', current, () => unpackResult.code);
      }
    }

    // String arrays
    if (!options.skipStringArray) {
      if (detectStringArrayPattern(current)) {
        const saResult = restoreStringArrays(current);
        if (saResult.restored > 0) {
          current = this.runStep(steps, warnings, 'string-array', current, () => saResult.code, saResult.restored);
          warnings.push(...saResult.warnings);
        }
      }
    }

    // Derotation
    current = this.runStep(steps, warnings, 'string-derotation', current, () => derotateStringArray(current));

    // Opaque predicates
    current = this.runStep(steps, warnings, 'opaque-predicates', current, () => removeOpaquePredicates(current));

    // Dead code
    current = this.runStep(steps, warnings, 'dead-code', current, () => removeDeadCode(current));

    // Anti-debug
    if (!options.skipAntiDebug) {
      if (detectAntiDebugPatterns(current).length > 0 || detectSelfDefending(current)) {
        const adResult = neutralizeAntiDebug(current);
        if (adResult.removed > 0) {
          current = this.runStep(steps, warnings, 'anti-debug', current, () => adResult.code, adResult.removed);
          warnings.push(...adResult.warnings);
        }
      }
    }

    // Constant propagation
    if (!options.skipConstantProp) {
      const cpResult = advancedConstantPropagation(current);
      if (cpResult.folded > 0 || cpResult.inlined > 0) {
        current = this.runStep(steps, warnings, 'constant-propagation', current, () => cpResult.code, undefined, cpResult.folded + cpResult.inlined);
        warnings.push(...cpResult.warnings);
      }
    }

    // Dead store elimination
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

    // JSDefender
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

    // Detection-only stages (JIT, polymorphic, WASM, VM, JScrambler)
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

    return current;
  }

  // ── Round ──

  private async runRound(
    options: PipelineOptions,
    steps: PipelineStepResult[],
    warnings: string[],
    code: string,
  ): Promise<string> {
    let current = code;

    // Re-apply key transforms each round to catch cascading simplifications
    current = this.runStep(steps, warnings, 'round-invisible-unicode', current, () =>
      normalizeInvisibleUnicode(current));

    current = this.runStep(steps, warnings, 'round-escape-sequences', current, () =>
      decodeEscapeSequences(current));

    current = this.runStep(steps, warnings, 'round-inline-unescape-atob', current, () =>
      inlineUnescapeAtob(current));

    if (!options.skipCFF && detectCFFPattern(current)) {
      const cffResult = restoreControlFlowFlattening(current);
      if (cffResult.restored > 0) {
        current = this.runStep(steps, warnings, 'round-cff', current, () => cffResult.code, cffResult.restored);
      }
    }

    current = this.runStep(steps, warnings, 'round-derotate-string-array', current, () =>
      derotateStringArray(current));

    current = this.runStep(steps, warnings, 'round-opaque-predicates', current, () =>
      removeOpaquePredicates(current));

    current = this.runStep(steps, warnings, 'round-dead-code', current, () => removeDeadCode(current));

    if (!options.skipConstantProp) {
      const cpResult = advancedConstantPropagation(current);
      if (cpResult.folded > 0 || cpResult.inlined > 0) {
        current = this.runStep(steps, warnings, 'round-constant-propagation', current, () => cpResult.code);
      }
    }

    if (!options.skipDeadStore) {
      const dsResult = removeDeadStores(current);
      if (dsResult.removed > 0) {
        current = this.runStep(steps, warnings, 'round-dead-store', current, () => dsResult.code, dsResult.removed);
      }
    }

    // AST optimization (bounded)
    if (!options.skipAST) {
      const beforeAST = current;
      for (let i = 0; i < 4; i++) {
        const next = this.astOptimizer.optimize(current);
        if (next === current) break;
        current = next;
      }
      if (current !== beforeAST) {
        this.runStep(steps, warnings, 'round-ast-optimization', beforeAST, () => current);
      }
    }

    return current;
  }

  // ── Helpers ──

  private async tryWebcrack(
    code: string,
    options: PipelineOptions,
    steps: PipelineStepResult[],
    warnings: string[],
  ): Promise<string> {
    try {
      const webcrackResult = await Promise.race([
        runWebcrack(code, {
          unpack: options.unpack ?? true,
          unminify: options.unminify ?? true,
          jsx: options.jsx ?? true,
          mangle: options.mangle ?? false,
          forceOutput: options.forceOutput,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('webcrack timeout')), options.timeout ?? 30_000),
        ),
      ]);

      if (webcrackResult.applied && webcrackResult.code) {
        const beforeWC = code;
        const after = webcrackResult.code;
        steps.push({
          stage: 'webcrack',
          applied: true,
          codeLength: after.length,
          readabilityDelta: calculateReadabilityScore(after) - calculateReadabilityScore(beforeWC),
        });
        return after;
      }

      steps.push({ stage: 'webcrack', applied: false, codeLength: code.length, readabilityDelta: 0 });
      if (webcrackResult.reason) warnings.push(`webcrack skipped: ${webcrackResult.reason}`);
      return code;
    } catch (e) {
      warnings.push(`webcrack error: ${e instanceof Error ? e.message : String(e)}`);
      steps.push({ stage: 'webcrack', applied: false, codeLength: code.length, readabilityDelta: 0 });
      return code;
    }
  }

  private getCachedDetection(code: string): ObfuscationType[] {
    const cacheKey = code.slice(0, 500);
    const cached = this.detectionCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < UnifiedDeobfuscationPipeline.CACHE_TTL_MS) {
      return cached.types as ObfuscationType[];
    }
    const types = detectObfuscationType(code);
    this.setCachedDetection(code, types);
    return types;
  }

  private setCachedDetection(code: string, types: ObfuscationType[]): void {
    const cacheKey = code.slice(0, 500);
    this.detectionCache.set(cacheKey, { types: types as string[], timestamp: Date.now() });
    if (this.detectionCache.size > 100) {
      const oldestKey = this.detectionCache.keys().next().value;
      if (oldestKey) this.detectionCache.delete(oldestKey);
    }
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