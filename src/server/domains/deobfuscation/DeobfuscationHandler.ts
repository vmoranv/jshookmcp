import type { ToolArgs } from '@server/types';
import { logger } from '@utils/logger';
import * as recast from 'recast';
import * as shift from 'shift-parser';
import { refactor } from 'shift-refactor';
import { codegen } from 'escodegen';
import OpenAI from 'openai';
import { Groq as GroqConstructor } from 'groq-sdk';
import { RateLimiter } from 'limiter';
import { detectObfuscationType } from '@modules/deobfuscator/Deobfuscator.utils';
import { DeobfuscationPipeline } from '@modules/deobfuscator/DeobfuscationPipeline';
import {
  UnifiedDeobfuscationPipeline,
  type PipelineOptions,
  type StrategyLane,
} from '@modules/deobfuscator/UnifiedPipeline';
import {
  canonicalizeVMHandlers,
  compareGenomes,
  type CanonicalizeResult,
  type OpcodeGenome,
} from '@modules/deobfuscator/VMHandlerCanonicalizer';
import {
  harvestWASM,
  type WASMExtractionResult,
  type WASMHarvesterOptions,
} from '@modules/deobfuscator/WASMHarvester';
import {
  codeToIR,
  applyIRTransforms,
  irToCode,
  roundTrip,
  analyzeIR,
  type IRTransformOptions,
} from '@modules/deobfuscator/ReversibleIR';
import {
  quarantinePoisonedNames,
  type QuarantineResult,
} from '@modules/deobfuscator/PoisonedNameQuarantine';
import {
  checkEquivalence,
  type EquivalenceResult,
} from '@modules/deobfuscator/EquivalenceOracle';
import {
  type BehavioralReconstruction,
} from '@modules/deobfuscator/BehavioralReconstructor';
import {
  detectPrelude,
  carvePrelude,
  type PreludeCarverResult,
} from '@modules/deobfuscator/PreludeCarver';
import {
  prepareHarvest,
  type SandboxMode,
  type HarvesterOptions,
} from '@modules/deobfuscator/RuntimeHarvester';

export class DeobfuscationHandler {
  private readonly rateLimiter: RateLimiter;
  private readonly pipeline = new DeobfuscationPipeline();
  private readonly unifiedPipeline = new UnifiedDeobfuscationPipeline(true);

  constructor(
    private readonly openai: OpenAI = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
    private readonly groqClient = new GroqConstructor({ apiKey: process.env.GROQ_API_KEY }),
  ) {
    this.rateLimiter = new RateLimiter({
      tokensPerInterval: 10,
      interval: 'minute',
      fireImmediately: true,
    });
  }

  async parseAST(args: ToolArgs): Promise<{ ast: unknown }> {
    const { code, parser } = args.input as { code: string; parser: 'recast' | 'shift' };
    try {
      const ast = parser === 'recast' ? recast.parse(code) : shift.parseScript(code);
      if (!ast) {
        throw new Error('Failed to parse code into AST');
      }
      logger.info(`[DeobfuscationHandler] Parsed AST using ${parser}`);
      return { ast };
    } catch (error) {
      const errorDetails = {
        error: 'ASTParsingFailed',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
        context: {
          codePreview: code.substring(0, 500),
          parser,
        },
      };
      logger.error(`AST parsing failed: ${JSON.stringify(errorDetails)}`);
      throw new Error(JSON.stringify(errorDetails));
    }
  }

  async applyTransform(args: ToolArgs): Promise<{ ast: unknown }> {
    const { transform, ast } = args.input as { transform: string; ast: unknown };
    try {
      let transformedAst = ast;
      if (transform === 'controlFlowNormalization') {
        transformedAst = this.normalizeControlFlow(ast);
      } else if (transform === 'deadCodeElimination') {
        transformedAst = this.eliminateDeadCode(ast);
      } else if (transform === 'constantPropagation') {
        transformedAst = this.propagateConstants(ast);
      } else if (transform === 'stringDecoding') {
        transformedAst = this.decodeStrings(ast);
      } else if (transform === 'controlFlowSimplification') {
        transformedAst = this.simplifyControlFlow(ast);
      }
      logger.info(`[DeobfuscationHandler] Applied transform: ${transform}`);
      return { ast: transformedAst };
    } catch (error) {
      const errorDetails = {
        error: 'TransformFailed',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
        context: { transform },
      };
      logger.error(`Transform failed: ${JSON.stringify(errorDetails)}`);
      throw new Error(JSON.stringify(errorDetails));
    }
  }

  async generateCode(args: ToolArgs): Promise<{ code: string }> {
    const { ast, generator } = args.input as { ast: unknown; generator: 'escodegen' | 'shift' };
    try {
      const code = generator === 'escodegen' ? codegen(ast) : this.generateShiftCode(ast);
      logger.info(`[DeobfuscationHandler] Generated code using ${generator}`);
      return { code };
    } catch (error) {
      const errorDetails = {
        error: 'CodeGenerationFailed',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
        context: { generator },
      };
      logger.error(`Code generation failed: ${JSON.stringify(errorDetails)}`);
      throw new Error(JSON.stringify(errorDetails));
    }
  }

  async detectObfuscationPatterns(args: ToolArgs): Promise<{ patterns: string[] }> {
    const { code } = args.input as { code: string };
    try {
      const patterns = detectObfuscationType(code);
      logger.info('[DeobfuscationHandler] Detected obfuscation patterns');
      return { patterns };
    } catch (error) {
      const errorDetails = {
        error: 'PatternDetectionFailed',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
        context: { codePreview: code.substring(0, 500) },
      };
      logger.error(`Pattern detection failed: ${JSON.stringify(errorDetails)}`);
      throw new Error(JSON.stringify(errorDetails));
    }
  }

  async runPipeline(args: ToolArgs): Promise<unknown> {
    const input = args.input as {
      code: string;
      unpack?: boolean;
      unminify?: boolean;
      jsx?: boolean;
      mangle?: boolean;
      timeout?: number;
      skipWebcrack?: boolean;
      skipAST?: boolean;
    };
    try {
      const result = await this.pipeline.run({
        code: input.code,
        unpack: input.unpack,
        unminify: input.unminify,
        jsx: input.jsx,
        mangle: input.mangle,
        timeout: input.timeout,
        skipWebcrack: input.skipWebcrack,
        skipAST: input.skipAST,
      });
      logger.info('[DeobfuscationHandler] Pipeline complete');
      return result;
    } catch (error) {
      const errorDetails = {
        error: 'PipelineFailed',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
        context: { codePreview: (input.code ?? '').substring(0, 500) },
      };
      logger.error(`Pipeline failed: ${JSON.stringify(errorDetails)}`);
      throw new Error(JSON.stringify(errorDetails));
    }
  }

  // ── Unified Pipeline (production-grade, strategy-routed) ──

  async runUnifiedPipeline(args: ToolArgs): Promise<unknown> {
    const input = args.input as {
      code: string;
      strategy?: StrategyLane;
      sandboxMode?: 'observe' | 'emulate' | 'strict';
      maxRounds?: number;
      skipWebcrack?: boolean;
      skipExotic?: boolean;
      skipPrelude?: boolean;
      skipQuarantine?: boolean;
      skipEquivalence?: boolean;
      skipBehavioral?: boolean;
    };
    try {
      const options: PipelineOptions = {
        code: input.code,
        strategyOverride: input.strategy,
        sandboxMode: input.sandboxMode,
        maxRounds: input.maxRounds,
        skipWebcrack: input.skipWebcrack,
        skipExotic: input.skipExotic,
        skipPrelude: input.skipPrelude,
        skipQuarantine: input.skipQuarantine,
        skipEquivalence: input.skipEquivalence,
        skipBehavioral: input.skipBehavioral,
      };
      const result = await this.unifiedPipeline.run(options);
      logger.info('[DeobfuscationHandler] Unified pipeline complete');
      return result;
    } catch (error) {
      const errorDetails = {
        error: 'UnifiedPipelineFailed',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
        context: { codePreview: (input.code ?? '').substring(0, 500) },
      };
      logger.error(`Unified pipeline failed: ${JSON.stringify(errorDetails)}`);
      throw new Error(JSON.stringify(errorDetails));
    }
  }

  // ── VM Handler Canonicalizer ──

  async canonicalizeVMHandlers(args: ToolArgs): Promise<CanonicalizeResult> {
    const { code } = args.input as { code: string };
    try {
      const result = canonicalizeVMHandlers(code);
      logger.info(`[DeobfuscationHandler] VM canonicalization: ${result.classifiedCount} classified, ${result.unknownCount} unknown`);
      return result;
    } catch (error) {
      const errorDetails = {
        error: 'VMCanonicalizationFailed',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      };
      logger.error(`VM canonicalization failed: ${JSON.stringify(errorDetails)}`);
      throw new Error(JSON.stringify(errorDetails));
    }
  }

  async compareVMGenomes(args: ToolArgs): Promise<{ similarity: number; sameVM: boolean; sharedCategories: string[] }> {
    const { genomeA, genomeB } = args.input as { genomeA: OpcodeGenome; genomeB: OpcodeGenome };
    try {
      const result = compareGenomes(genomeA, genomeB);
      logger.info(`[DeobfuscationHandler] VM genome comparison: similarity=${result.similarity.toFixed(2)}, sameVM=${result.sameVM}`);
      return result;
    } catch (error) {
      const errorDetails = {
        error: 'VMGenomeComparisonFailed',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      };
      logger.error(`VM genome comparison failed: ${JSON.stringify(errorDetails)}`);
      throw new Error(JSON.stringify(errorDetails));
    }
  }

  // ── WASM Harvester ──

  async harvestWASM(args: ToolArgs): Promise<WASMExtractionResult> {
    const input = args.input as {
      code: string;
      maxModuleSize?: number;
      extractStrings?: boolean;
      decodeBase64?: boolean;
      traceInterfaces?: boolean;
    };
    try {
      const options: WASMHarvesterOptions = {
        maxModuleSize: input.maxModuleSize,
        extractStrings: input.extractStrings,
        decodeBase64: input.decodeBase64,
        traceInterfaces: input.traceInterfaces,
      };
      const result = harvestWASM(input.code, options);
      logger.info(`[DeobfuscationHandler] WASM harvest: ${result.moduleCount} modules, ${result.decodedStrings.length} strings`);
      return result;
    } catch (error) {
      const errorDetails = {
        error: 'WASMHarvestFailed',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      };
      logger.error(`WASM harvest failed: ${JSON.stringify(errorDetails)}`);
      throw new Error(JSON.stringify(errorDetails));
    }
  }

  // ── Reversible IR ──

  async analyzeWithIR(args: ToolArgs): Promise<unknown> {
    const input = args.input as {
      code: string;
      constantFolding?: boolean;
      deadCodeElimination?: boolean;
      flowSensitivePropagation?: boolean;
      preludeResolution?: boolean;
      maxIterations?: number;
    };
    try {
      const irResult = codeToIR(input.code);
      if (!irResult.ir) {
        return { ok: false, error: irResult.error };
      }

      const transformOptions: IRTransformOptions = {
        constantFolding: input.constantFolding,
        deadCodeElimination: input.deadCodeElimination,
        flowSensitivePropagation: input.flowSensitivePropagation,
        preludeResolution: input.preludeResolution,
        maxIterations: input.maxIterations,
      };

      const transformedIR = applyIRTransforms(irResult.ir, transformOptions);
      const analysis = analyzeIR(transformedIR);
      const reconstructedCode = irToCode(transformedIR);

      logger.info(`[DeobfuscationHandler] IR analysis: ${analysis.totalNodes} nodes, ${analysis.functionCount} functions`);
      return {
        ok: true,
        analysis,
        reconstructedCode,
        transformLog: transformedIR.transformLog,
      };
    } catch (error) {
      const errorDetails = {
        error: 'IRAnalysisFailed',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      };
      logger.error(`IR analysis failed: ${JSON.stringify(errorDetails)}`);
      throw new Error(JSON.stringify(errorDetails));
    }
  }

  async irRoundTrip(args: ToolArgs): Promise<{ code: string; fidelity: number; error?: string }> {
    const { code } = args.input as { code: string };
    try {
      const result = roundTrip(code);
      logger.info(`[DeobfuscationHandler] IR round-trip fidelity: ${result.fidelity.toFixed(1)}%`);
      return { code: result.code, fidelity: result.fidelity, error: result.error };
    } catch (error) {
      const errorDetails = {
        error: 'IRRoundTripFailed',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      };
      logger.error(`IR round-trip failed: ${JSON.stringify(errorDetails)}`);
      throw new Error(JSON.stringify(errorDetails));
    }
  }

  // ── Poisoned Name Quarantine ──

  async quarantinePoisonedNames(args: ToolArgs): Promise<QuarantineResult> {
    const { code } = args.input as { code: string };
    try {
      const result = quarantinePoisonedNames(code);
      logger.info(`[DeobfuscationHandler] Quarantine: ${result.replacedCount} names replaced, LLM risk=${result.llmRisk.level}`);
      return result;
    } catch (error) {
      const errorDetails = {
        error: 'QuarantineFailed',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      };
      logger.error(`Quarantine failed: ${JSON.stringify(errorDetails)}`);
      throw new Error(JSON.stringify(errorDetails));
    }
  }

  // ── Equivalence Oracle ──

  async validateEquivalence(args: ToolArgs): Promise<EquivalenceResult> {
    const { originalCode, deobfuscatedCode } = args.input as { originalCode: string; deobfuscatedCode: string };
    try {
      const result = await checkEquivalence(originalCode, deobfuscatedCode);
      logger.info(`[DeobfuscationHandler] Equivalence: ${result.equivalent ? 'PASS' : 'FAIL'}, confidence=${result.confidence.toFixed(2)}`);
      return result;
    } catch (error) {
      const errorDetails = {
        error: 'EquivalenceValidationFailed',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      };
      logger.error(`Equivalence validation failed: ${JSON.stringify(errorDetails)}`);
      throw new Error(JSON.stringify(errorDetails));
    }
  }

  // ── Prelude Carver ──

  async carvePrelude(args: ToolArgs): Promise<PreludeCarverResult> {
    const { code } = args.input as { code: string };
    try {
      const preludeFunctions = detectPrelude(code);
      const result = carvePrelude(code, preludeFunctions);
      logger.info(`[DeobfuscationHandler] Prelude carving: ${result.preludeFunctions.length} functions, ${result.replaced} calls replaced`);
      return result;
    } catch (error) {
      const errorDetails = {
        error: 'PreludeCarvingFailed',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      };
      logger.error(`Prelude carving failed: ${JSON.stringify(errorDetails)}`);
      throw new Error(JSON.stringify(errorDetails));
    }
  }

  // ── Runtime Harvester ──

  async prepareRuntimeHarvest(args: ToolArgs): Promise<{ harnessCode: string; options: HarvesterOptions }> {
    const input = args.input as {
      code: string;
      mode?: SandboxMode;
      preserveToString?: boolean;
      fakeEnvironment?: boolean;
      captureWASM?: boolean;
    };
    try {
      const result = prepareHarvest(input.code, input.mode ?? 'emulate', {
        preserveToString: input.preserveToString,
        fakeEnvironment: input.fakeEnvironment,
        captureWASM: input.captureWASM,
      });
      logger.info('[DeobfuscationHandler] Runtime harvest harness prepared');
      return result;
    } catch (error) {
      const errorDetails = {
        error: 'HarvestPreparationFailed',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      };
      logger.error(`Harvest preparation failed: ${JSON.stringify(errorDetails)}`);
      throw new Error(JSON.stringify(errorDetails));
    }
  }

  // ── Behavioral Reconstructor ──

  async reconstructBehavior(args: ToolArgs): Promise<BehavioralReconstruction> {
    const input = args.input as {
      code: string;
    };
    try {
      // Note: reconstructBehavior requires an ExecutionSandbox instance.
      // For now, we return a placeholder. Full integration requires sandbox setup.
      const result: BehavioralReconstruction = {
        ok: false,
        code: input.code,
        summary: 'Behavioral reconstruction requires sandbox execution. Use runtime_tracer first.',
        capabilities: [],
        confidence: 0,
        warnings: ['Sandbox not available in this context'],
        method: 'failed',
        captures: [],
        preludeFunctions: [],
      };
      logger.info('[DeobfuscationHandler] Behavioral reconstruction: placeholder returned');
      return result;
    } catch (error) {
      const errorDetails = {
        error: 'BehavioralReconstructionFailed',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      };
      logger.error(`Behavioral reconstruction failed: ${JSON.stringify(errorDetails)}`);
      throw new Error(JSON.stringify(errorDetails));
    }
  }

  // ── Placeholder methods for existing manifest entries ──

  async analyzeVMBytecode(args: ToolArgs): Promise<{ bytecode: string; vmMetadata: Record<string, unknown> }> {
    const { code } = args.input as { code: string };
    const vmResult = canonicalizeVMHandlers(code);
    return {
      bytecode: code,
      vmMetadata: {
        handlerCount: vmResult.genome.handlerCount,
        toolIdentifier: vmResult.genome.toolIdentifier,
        complexityScore: vmResult.genome.complexityScore,
        hasRotatedOpcodes: vmResult.genome.hasRotatedOpcodes,
        hasIntegrityChecks: vmResult.genome.hasIntegrityChecks,
      },
    };
  }

  async emulateVM(args: ToolArgs): Promise<{ state: Record<string, unknown> }> {
    const { bytecode } = args.input as { bytecode: string };
    // Placeholder: actual VM emulation would require a JS VM interpreter
    return { state: { bytecodeLength: bytecode.length, note: 'VM emulation not yet implemented' } };
  }

  async reconstructControlFlow(args: ToolArgs): Promise<{ ast: unknown }> {
    const { vmState } = args.input as { vmState: Record<string, unknown> };
    // Placeholder: actual control flow reconstruction would require VM state analysis
    return { ast: vmState };
  }

  async humanizeCode(args: ToolArgs): Promise<{
    humanizedCode: string;
    suggestions: string[];
    modelConsensus: Record<string, { code: string; suggestions: string[]; model: string }>;
  }> {
    const input = args.input as {
      code: string;
      models?: string[];
      aggressiveness?: number;
    };
    const models = input.models ?? ['openai'];
    const aggressiveness = input.aggressiveness ?? 5;
    const modelConsensus: Record<string, { code: string; suggestions: string[]; model: string }> = {};
    const allSuggestions: string[] = [];

    for (const model of models) {
      try {
        let explanation: string;
        if (model === 'openai') {
          await this.rateLimiter.removeTokens(1);
          const response = await this.openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
              {
                role: 'system',
                content: `You are a code humanization expert. Transform the following obfuscated code into readable, well-commented, idiomatic JavaScript. Aggressiveness level: ${aggressiveness}/10 (higher = more aggressive renaming and restructuring).`,
              },
              { role: 'user', content: input.code.substring(0, 8000) },
            ],
            max_tokens: 2048,
          });
          explanation = response.choices[0]?.message?.content ?? '';
        } else if (model === 'groq') {
          await this.rateLimiter.removeTokens(1);
          const response = await this.groqClient.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [
              {
                role: 'system',
                content: `You are a code humanization expert. Transform the following obfuscated code into readable, well-commented, idiomatic JavaScript. Aggressiveness level: ${aggressiveness}/10.`,
              },
              { role: 'user', content: input.code.substring(0, 8000) },
            ],
            max_tokens: 2048,
          });
          explanation = response.choices[0]?.message?.content ?? '';
        } else {
          continue;
        }

        // Extract code block from response
        const codeMatch = explanation.match(/```(?:javascript|js)?\n([\s\S]*?)```/);
        const humanizedCode = codeMatch ? (codeMatch[1] ?? explanation) : explanation;
        const suggestions = explanation.split('\n').filter((line) => line.startsWith('-') || line.startsWith('*')).map((s) => s.trim());

        modelConsensus[model] = { code: humanizedCode, suggestions, model };
        allSuggestions.push(...suggestions);
      } catch (e) {
        logger.warn(`[DeobfuscationHandler] humanizeCode: ${model} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const bestModel = Object.values(modelConsensus)[0];
    return {
      humanizedCode: bestModel?.code ?? input.code,
      suggestions: [...new Set(allSuggestions)],
      modelConsensus,
    };
  }

  async explainCodeOpenAI(args: ToolArgs): Promise<{ explanation: string }> {
    const { code, patterns } = args.input as { code: string; patterns: string[] };
    try {
      await this.rateLimiter.removeTokens(1);
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are a deobfuscation assistant. Explain the following obfuscated code concisely.',
          },
          {
            role: 'user',
            content: `Code:\n${code.substring(0, 4000)}\n\nDetected patterns: ${patterns.join(', ')}`,
          },
        ],
        max_tokens: 1024,
      });
      const explanation = response.choices[0]?.message?.content ?? 'No explanation generated.';
      logger.info('[DeobfuscationHandler] Generated OpenAI explanation');
      return { explanation };
    } catch (error) {
      const errorDetails = {
        error: 'OpenAIExplanationFailed',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
        context: { codePreview: code.substring(0, 500), patterns },
      };
      logger.error(`OpenAI explanation failed: ${JSON.stringify(errorDetails)}`);
      throw new Error(JSON.stringify(errorDetails));
    }
  }

  async explainCodeGroq(args: ToolArgs): Promise<{ explanation: string }> {
    const { code, patterns } = args.input as { code: string; patterns: string[] };
    try {
      await this.rateLimiter.removeTokens(1);
      const response = await this.groqClient.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: 'You are a deobfuscation assistant. Explain the following obfuscated code concisely.',
          },
          {
            role: 'user',
            content: `Code:\n${code.substring(0, 4000)}\n\nDetected patterns: ${patterns.join(', ')}`,
          },
        ],
        max_tokens: 1024,
      });
      const explanation = response.choices[0]?.message?.content ?? 'No explanation generated.';
      logger.info('[DeobfuscationHandler] Generated Groq explanation');
      return { explanation };
    } catch (error) {
      const errorDetails = {
        error: 'GroqExplanationFailed',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
        context: { codePreview: code.substring(0, 500), patterns },
      };
      logger.error(`Groq explanation failed: ${JSON.stringify(errorDetails)}`);
      throw new Error(JSON.stringify(errorDetails));
    }
  }

  async suggestTransformations(args: ToolArgs): Promise<{ transformations: string[] }> {
    const { patterns, explanation } = args.input as { patterns: string[]; explanation: string };
    try {
      const transformationMap: Record<string, string[]> = {
        'javascript-obfuscator': ['string-array-replacement', 'hex-literal-normalization', 'dead-code-removal'],
        'webpack': ['bundle-unpack', 'module-resolution'],
        'packer': ['packer-unpack'],
        'eval-obfuscation': ['eval-expansion', 'atob-inline-decode'],
        'control-flow-flattening': ['control-flow-unflattening'],
        'dead-code-injection': ['dead-code-elimination'],
        'opaque-predicates': ['opaque-predicate-removal'],
        'hex-encoding': ['hex-decode'],
        'base64-encoding': ['base64-decode'],
        'jsfuck': ['jsfuck-eval'],
        'aaencode': ['aaencode-eval'],
        'jjencode': ['jjencode-eval'],
        'vm-protection': ['vm-deobfuscation'],
        'uglify': ['unminify'],
        'unknown': ['full-pipeline'],
      };

      const transformations = new Set<string>();
      for (const p of patterns) {
        for (const t of transformationMap[p] ?? []) {
          transformations.add(t);
        }
      }

      if (explanation.toLowerCase().includes('string array')) {
        transformations.add('string-array-replacement');
      }
      if (explanation.toLowerCase().includes('base64')) {
        transformations.add('base64-decode');
      }

      logger.info('[DeobfuscationHandler] Suggested transformations');
      return { transformations: Array.from(transformations) };
    } catch (error) {
      const errorDetails = {
        error: 'TransformationSuggestionFailed',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
        context: { patterns, explanationPreview: explanation.substring(0, 500) },
      };
      logger.error(`Transformation suggestion failed: ${JSON.stringify(errorDetails)}`);
      throw new Error(JSON.stringify(errorDetails));
    }
  }

  private normalizeControlFlow(ast: unknown): unknown {
    return ast;
  }

  private eliminateDeadCode(ast: unknown): unknown {
    return ast;
  }

  private propagateConstants(ast: unknown): unknown {
    return ast;
  }

  private decodeStrings(ast: unknown): unknown {
    try {
      const $script = refactor(ast as Parameters<typeof refactor>[0]);
      $script('LiteralStringExpression').forEach((_node) => {
      });
      return ($script as unknown as { session: { root: unknown } }).session.root;
    } catch {
      return ast;
    }
  }

  private simplifyControlFlow(ast: unknown): unknown {
    return ast;
  }

  private generateShiftCode(_ast: unknown): string {
    return '';
  }
}
