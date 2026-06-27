/**
 * Analysis domain handlers aggregation.
 * Re-exports all handler modules (10 files → single entry point).
 */

import type {
  AdvancedDeobfuscator,
  CodeAnalyzer,
  CryptoDetector,
  Deobfuscator,
  HookManager,
  ObfuscationDetector,
  ScriptManager,
} from '@server/domains/shared/modules';
import type { CodeCollector } from '@server/domains/shared/modules/collector';
import type { ToolArgs, ToolResponse } from '@server/types';

// Import handlers
import {
  handleDeobfuscate,
  handleWebcrackUnpack,
  handleAnalysisDecodeStringArray,
} from './handlers/deobfuscation';
import { handleJsDeobfuscateJsvmp, handleJsAnalyzeVm } from './handlers/jsvmp';
import { handleAnalysisAstMatch, handleAnalysisDeflatControlFlow } from './handlers/ast-analysis';
import { handleJsSymbolicExecute, handleJsSymbolicExecuteJsvmp } from './handlers/symbolic';
import {
  handleUnderstandCode,
  handleDetectCrypto,
  handleDetectObfuscation,
} from './handlers/code-understanding';
import { handleJsDeobfuscatePipeline, handleJsSolveConstraints } from './handlers/pipeline';
import { CollectionHandlers } from './handlers/collection';
import { DataManagementHandlers } from './handlers/data-management';
import { handleManageHooks } from './handlers/hooks';
import { handleWebpackEnumerate } from './handlers/webpack';
import { handleAiSuggestExploits } from './handlers/exploit-suggestion';
import { handleAnalysisDataFlow } from './handlers/data-flow';
import { handleAnalysisSecurityScan } from './handlers/security-scan';
import { JSVMPDeobfuscator } from '@modules/deobfuscator/JSVMPDeobfuscator';
import { JScramberDeobfuscator } from '@modules/deobfuscator/JScramblerDeobfuscator';
import { UniversalUnpacker } from '@modules/deobfuscator/PackerDeobfuscator';
import { VMDeobfuscator } from '@modules/deobfuscator/VMDeobfuscator';
import type { LLMSamplingBridge } from '@server/LLMSamplingBridge';

interface CoreAnalysisHandlerDeps {
  collector: CodeCollector;
  scriptManager: ScriptManager;
  deobfuscator: Deobfuscator;
  advancedDeobfuscator: AdvancedDeobfuscator;
  obfuscationDetector: ObfuscationDetector;
  analyzer: CodeAnalyzer;
  cryptoDetector: CryptoDetector;
  hookManager: HookManager;
  samplingBridge: LLMSamplingBridge;
  jscramblerDeobfuscator: JScramberDeobfuscator;
  packerDeobfuscator: UniversalUnpacker;
  vmDeobfuscator: VMDeobfuscator;
}

export class CoreAnalysisHandlers {
  private readonly collector: CodeCollector;
  private readonly scriptManager: ScriptManager;
  private readonly deobfuscator: Deobfuscator;
  private readonly advancedDeobfuscator: AdvancedDeobfuscator;
  private readonly obfuscationDetector: ObfuscationDetector;
  private readonly analyzer: CodeAnalyzer;
  private readonly cryptoDetector: CryptoDetector;
  private readonly hookManager: HookManager;
  private readonly samplingBridge: LLMSamplingBridge;
  private readonly jsvmpDeobfuscator: JSVMPDeobfuscator;
  private readonly jscramblerDeobfuscator: JScramberDeobfuscator;
  private readonly packerDeobfuscator: UniversalUnpacker;
  private readonly vmDeobfuscator: VMDeobfuscator;
  private readonly collectionHandlers: CollectionHandlers;
  private readonly dataManagementHandlers: DataManagementHandlers;

  constructor(deps: CoreAnalysisHandlerDeps) {
    this.collector = deps.collector;
    this.scriptManager = deps.scriptManager;
    this.deobfuscator = deps.deobfuscator;
    this.advancedDeobfuscator = deps.advancedDeobfuscator;
    this.obfuscationDetector = deps.obfuscationDetector;
    this.analyzer = deps.analyzer;
    this.cryptoDetector = deps.cryptoDetector;
    this.hookManager = deps.hookManager;
    this.samplingBridge = deps.samplingBridge;
    this.jsvmpDeobfuscator = new JSVMPDeobfuscator();
    this.jscramblerDeobfuscator = deps.jscramblerDeobfuscator;
    this.packerDeobfuscator = deps.packerDeobfuscator;
    this.vmDeobfuscator = deps.vmDeobfuscator;
    this.collectionHandlers = new CollectionHandlers({
      collector: this.collector,
      scriptManager: this.scriptManager,
    });
    this.dataManagementHandlers = new DataManagementHandlers({
      collector: this.collector,
      scriptManager: this.scriptManager,
    });
  }

  // Collection
  async handleCollectCode(args: ToolArgs): Promise<ToolResponse> {
    return this.collectionHandlers.handleCollectCode(args);
  }

  async handleSearchInScripts(args: ToolArgs): Promise<ToolResponse> {
    return this.collectionHandlers.handleSearchInScripts(args);
  }

  async handleExtractFunctionTree(args: ToolArgs): Promise<ToolResponse> {
    return this.collectionHandlers.handleExtractFunctionTree(args);
  }

  // Deobfuscation
  async handleDeobfuscate(args: ToolArgs): Promise<ToolResponse> {
    return handleDeobfuscate(
      args,
      this.deobfuscator,
      this.advancedDeobfuscator,
      this.jscramblerDeobfuscator,
      this.packerDeobfuscator,
      this.vmDeobfuscator,
    );
  }

  async handleWebcrackUnpack(args: ToolArgs): Promise<ToolResponse> {
    return handleWebcrackUnpack(args);
  }

  async handleAnalysisDecodeStringArray(args: ToolArgs): Promise<ToolResponse> {
    return handleAnalysisDecodeStringArray(args);
  }

  // Code understanding
  async handleUnderstandCode(args: ToolArgs): Promise<ToolResponse> {
    return handleUnderstandCode(args, this.analyzer);
  }

  async handleDetectCrypto(args: ToolArgs): Promise<ToolResponse> {
    return handleDetectCrypto(args, this.cryptoDetector);
  }

  async handleDetectObfuscation(args: ToolArgs): Promise<ToolResponse> {
    return handleDetectObfuscation(args, this.obfuscationDetector);
  }

  // JSVMP
  async handleJsDeobfuscateJsvmp(args: ToolArgs): Promise<ToolResponse> {
    return handleJsDeobfuscateJsvmp(args, this.jsvmpDeobfuscator);
  }

  async handleJsAnalyzeVm(args: ToolArgs): Promise<ToolResponse> {
    return handleJsAnalyzeVm(args, this.jsvmpDeobfuscator);
  }

  // Pipeline
  async handleJsDeobfuscatePipeline(args: ToolArgs): Promise<ToolResponse> {
    return handleJsDeobfuscatePipeline(args);
  }

  async handleJsSolveConstraints(args: ToolArgs): Promise<ToolResponse> {
    return handleJsSolveConstraints(args);
  }

  // AST analysis
  async handleAnalysisAstMatch(args: ToolArgs): Promise<ToolResponse> {
    return handleAnalysisAstMatch(args);
  }

  async handleAnalysisDeflatControlFlow(args: ToolArgs): Promise<ToolResponse> {
    return handleAnalysisDeflatControlFlow(args);
  }

  // Symbolic execution
  async handleJsSymbolicExecute(args: ToolArgs): Promise<ToolResponse> {
    return handleJsSymbolicExecute(args);
  }

  async handleJsSymbolicExecuteJsvmp(args: ToolArgs): Promise<ToolResponse> {
    return handleJsSymbolicExecuteJsvmp(args);
  }

  // Hooks
  async handleManageHooks(args: ToolArgs): Promise<ToolResponse> {
    return handleManageHooks(args, this.hookManager);
  }

  // Webpack
  async handleWebpackEnumerate(args: ToolArgs): Promise<ToolResponse> {
    return handleWebpackEnumerate(this.collector, args);
  }

  // Data management
  async handleClearCollectedData(): Promise<ToolResponse> {
    return this.dataManagementHandlers.handleClearCollectedData();
  }

  async handleGetCollectionStats(): Promise<ToolResponse> {
    return this.dataManagementHandlers.handleGetCollectionStats();
  }

  // Exploit suggestion (migrated from ai-assist)
  async handleAiSuggestExploits(args: ToolArgs): Promise<ToolResponse> {
    return handleAiSuggestExploits(this.samplingBridge, args);
  }

  // Data flow analysis
  async handleAnalysisDataFlow(args: ToolArgs): Promise<ToolResponse> {
    return handleAnalysisDataFlow(args);
  }

  // Security scan
  async handleAnalysisSecurityScan(args: ToolArgs): Promise<ToolResponse> {
    return handleAnalysisSecurityScan(args);
  }
}
