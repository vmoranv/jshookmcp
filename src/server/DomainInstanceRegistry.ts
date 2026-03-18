import type { CodeCollector } from '@modules/collector/CodeCollector';
import type { PageController } from '@modules/collector/PageController';
import type { DOMInspector } from '@modules/collector/DOMInspector';
import type { ScriptManager } from '@modules/debugger/ScriptManager';
import type { DebuggerManager } from '@modules/debugger/DebuggerManager';
import type { RuntimeInspector } from '@modules/debugger/RuntimeInspector';
import type { ConsoleMonitor } from '@modules/monitor/ConsoleMonitor';
import type { BrowserToolHandlers } from '@server/domains/browser/index';
import type { DebuggerToolHandlers } from '@server/domains/debugger/index';
import type { AdvancedToolHandlers } from '@server/domains/network/index';
import type { AIHookToolHandlers, HookPresetToolHandlers } from '@server/domains/hooks/index';
import type { Deobfuscator } from '@modules/deobfuscator/Deobfuscator';
import type { AdvancedDeobfuscator } from '@modules/deobfuscator/AdvancedDeobfuscator';
import type { ASTOptimizer } from '@modules/deobfuscator/ASTOptimizer';
import type { ObfuscationDetector } from '@modules/detector/ObfuscationDetector';
import type { LLMService } from '@services/LLMService';
import type { CodeAnalyzer } from '@modules/analyzer/CodeAnalyzer';
import type { CryptoDetector } from '@modules/crypto/CryptoDetector';
import type { HookManager } from '@modules/hook/HookManager';
import type { CoreAnalysisHandlers } from '@server/domains/analysis/index';
import type {
  CoreMaintenanceHandlers,
  ExtensionManagementHandlers,
} from '@server/domains/maintenance/index';
import type { ProcessToolHandlers } from '@server/domains/process/index';
import type { WorkflowHandlers } from '@server/domains/workflow/index';
import type { WasmToolHandlers } from '@server/domains/wasm/index';
import type { StreamingToolHandlers } from '@server/domains/streaming/index';
import type { EncodingToolHandlers } from '@server/domains/encoding/index';
import type { AntiDebugToolHandlers } from '@server/domains/antidebug/index';
import type { GraphQLToolHandlers } from '@server/domains/graphql/index';
import type { PlatformToolHandlers } from '@server/domains/platform/index';
import type { SourcemapToolHandlers } from '@server/domains/sourcemap/index';
import type { TransformToolHandlers } from '@server/domains/transform/index';

/**
 * Registry for lazy-initialized domain instances.
 * Replaces the 33 individual properties previously stored on MCPServer.
 *
 * This class maintains lazy initialization semantics: each domain instance
 * is created on-demand when first accessed via its getter.
 */
export class DomainInstanceRegistry {
  // Core module instances
  private _collector?: CodeCollector;
  private _pageController?: PageController;
  private _domInspector?: DOMInspector;
  private _scriptManager?: ScriptManager;
  private _debuggerManager?: DebuggerManager;
  private _runtimeInspector?: RuntimeInspector;
  private _consoleMonitor?: ConsoleMonitor;
  private _llm?: LLMService;
  private _deobfuscator?: Deobfuscator;
  private _advancedDeobfuscator?: AdvancedDeobfuscator;
  private _astOptimizer?: ASTOptimizer;
  private _obfuscationDetector?: ObfuscationDetector;
  private _analyzer?: CodeAnalyzer;
  private _cryptoDetector?: CryptoDetector;
  private _hookManager?: HookManager;

  // Tool handler instances
  private _browserHandlers?: BrowserToolHandlers;
  private _debuggerHandlers?: DebuggerToolHandlers;
  private _advancedHandlers?: AdvancedToolHandlers;
  private _aiHookHandlers?: AIHookToolHandlers;
  private _hookPresetHandlers?: HookPresetToolHandlers;
  private _coreAnalysisHandlers?: CoreAnalysisHandlers;
  private _coreMaintenanceHandlers?: CoreMaintenanceHandlers;
  private _extensionManagementHandlers?: ExtensionManagementHandlers;
  private _processHandlers?: ProcessToolHandlers;
  private _workflowHandlers?: WorkflowHandlers;
  private _wasmHandlers?: WasmToolHandlers;
  private _streamingHandlers?: StreamingToolHandlers;
  private _encodingHandlers?: EncodingToolHandlers;
  private _antidebugHandlers?: AntiDebugToolHandlers;
  private _graphqlHandlers?: GraphQLToolHandlers;
  private _platformHandlers?: PlatformToolHandlers;
  private _sourcemapHandlers?: SourcemapToolHandlers;
  private _transformHandlers?: TransformToolHandlers;

  /* ---------- Core module getters/setters ---------- */

  public get collector(): CodeCollector | undefined {
    return this._collector;
  }

  public set collector(value: CodeCollector | undefined) {
    this._collector = value;
  }

  public get pageController(): PageController | undefined {
    return this._pageController;
  }

  public set pageController(value: PageController | undefined) {
    this._pageController = value;
  }

  public get domInspector(): DOMInspector | undefined {
    return this._domInspector;
  }

  public set domInspector(value: DOMInspector | undefined) {
    this._domInspector = value;
  }

  public get scriptManager(): ScriptManager | undefined {
    return this._scriptManager;
  }

  public set scriptManager(value: ScriptManager | undefined) {
    this._scriptManager = value;
  }

  public get debuggerManager(): DebuggerManager | undefined {
    return this._debuggerManager;
  }

  public set debuggerManager(value: DebuggerManager | undefined) {
    this._debuggerManager = value;
  }

  public get runtimeInspector(): RuntimeInspector | undefined {
    return this._runtimeInspector;
  }

  public set runtimeInspector(value: RuntimeInspector | undefined) {
    this._runtimeInspector = value;
  }

  public get consoleMonitor(): ConsoleMonitor | undefined {
    return this._consoleMonitor;
  }

  public set consoleMonitor(value: ConsoleMonitor | undefined) {
    this._consoleMonitor = value;
  }

  public get llm(): LLMService | undefined {
    return this._llm;
  }

  public set llm(value: LLMService | undefined) {
    this._llm = value;
  }

  public get deobfuscator(): Deobfuscator | undefined {
    return this._deobfuscator;
  }

  public set deobfuscator(value: Deobfuscator | undefined) {
    this._deobfuscator = value;
  }

  public get advancedDeobfuscator(): AdvancedDeobfuscator | undefined {
    return this._advancedDeobfuscator;
  }

  public set advancedDeobfuscator(value: AdvancedDeobfuscator | undefined) {
    this._advancedDeobfuscator = value;
  }

  public get astOptimizer(): ASTOptimizer | undefined {
    return this._astOptimizer;
  }

  public set astOptimizer(value: ASTOptimizer | undefined) {
    this._astOptimizer = value;
  }

  public get obfuscationDetector(): ObfuscationDetector | undefined {
    return this._obfuscationDetector;
  }

  public set obfuscationDetector(value: ObfuscationDetector | undefined) {
    this._obfuscationDetector = value;
  }

  public get analyzer(): CodeAnalyzer | undefined {
    return this._analyzer;
  }

  public set analyzer(value: CodeAnalyzer | undefined) {
    this._analyzer = value;
  }

  public get cryptoDetector(): CryptoDetector | undefined {
    return this._cryptoDetector;
  }

  public set cryptoDetector(value: CryptoDetector | undefined) {
    this._cryptoDetector = value;
  }

  public get hookManager(): HookManager | undefined {
    return this._hookManager;
  }

  public set hookManager(value: HookManager | undefined) {
    this._hookManager = value;
  }

  /* ---------- Tool handler getters/setters ---------- */

  public get browserHandlers(): BrowserToolHandlers | undefined {
    return this._browserHandlers;
  }

  public set browserHandlers(value: BrowserToolHandlers | undefined) {
    this._browserHandlers = value;
  }

  public get debuggerHandlers(): DebuggerToolHandlers | undefined {
    return this._debuggerHandlers;
  }

  public set debuggerHandlers(value: DebuggerToolHandlers | undefined) {
    this._debuggerHandlers = value;
  }

  public get advancedHandlers(): AdvancedToolHandlers | undefined {
    return this._advancedHandlers;
  }

  public set advancedHandlers(value: AdvancedToolHandlers | undefined) {
    this._advancedHandlers = value;
  }

  public get aiHookHandlers(): AIHookToolHandlers | undefined {
    return this._aiHookHandlers;
  }

  public set aiHookHandlers(value: AIHookToolHandlers | undefined) {
    this._aiHookHandlers = value;
  }

  public get hookPresetHandlers(): HookPresetToolHandlers | undefined {
    return this._hookPresetHandlers;
  }

  public set hookPresetHandlers(value: HookPresetToolHandlers | undefined) {
    this._hookPresetHandlers = value;
  }

  public get coreAnalysisHandlers(): CoreAnalysisHandlers | undefined {
    return this._coreAnalysisHandlers;
  }

  public set coreAnalysisHandlers(value: CoreAnalysisHandlers | undefined) {
    this._coreAnalysisHandlers = value;
  }

  public get coreMaintenanceHandlers(): CoreMaintenanceHandlers | undefined {
    return this._coreMaintenanceHandlers;
  }

  public set coreMaintenanceHandlers(value: CoreMaintenanceHandlers | undefined) {
    this._coreMaintenanceHandlers = value;
  }

  public get extensionManagementHandlers(): ExtensionManagementHandlers | undefined {
    return this._extensionManagementHandlers;
  }

  public set extensionManagementHandlers(value: ExtensionManagementHandlers | undefined) {
    this._extensionManagementHandlers = value;
  }

  public get processHandlers(): ProcessToolHandlers | undefined {
    return this._processHandlers;
  }

  public set processHandlers(value: ProcessToolHandlers | undefined) {
    this._processHandlers = value;
  }

  public get workflowHandlers(): WorkflowHandlers | undefined {
    return this._workflowHandlers;
  }

  public set workflowHandlers(value: WorkflowHandlers | undefined) {
    this._workflowHandlers = value;
  }

  public get wasmHandlers(): WasmToolHandlers | undefined {
    return this._wasmHandlers;
  }

  public set wasmHandlers(value: WasmToolHandlers | undefined) {
    this._wasmHandlers = value;
  }

  public get streamingHandlers(): StreamingToolHandlers | undefined {
    return this._streamingHandlers;
  }

  public set streamingHandlers(value: StreamingToolHandlers | undefined) {
    this._streamingHandlers = value;
  }

  public get encodingHandlers(): EncodingToolHandlers | undefined {
    return this._encodingHandlers;
  }

  public set encodingHandlers(value: EncodingToolHandlers | undefined) {
    this._encodingHandlers = value;
  }

  public get antidebugHandlers(): AntiDebugToolHandlers | undefined {
    return this._antidebugHandlers;
  }

  public set antidebugHandlers(value: AntiDebugToolHandlers | undefined) {
    this._antidebugHandlers = value;
  }

  public get graphqlHandlers(): GraphQLToolHandlers | undefined {
    return this._graphqlHandlers;
  }

  public set graphqlHandlers(value: GraphQLToolHandlers | undefined) {
    this._graphqlHandlers = value;
  }

  public get platformHandlers(): PlatformToolHandlers | undefined {
    return this._platformHandlers;
  }

  public set platformHandlers(value: PlatformToolHandlers | undefined) {
    this._platformHandlers = value;
  }

  public get sourcemapHandlers(): SourcemapToolHandlers | undefined {
    return this._sourcemapHandlers;
  }

  public set sourcemapHandlers(value: SourcemapToolHandlers | undefined) {
    this._sourcemapHandlers = value;
  }

  public get transformHandlers(): TransformToolHandlers | undefined {
    return this._transformHandlers;
  }

  public set transformHandlers(value: TransformToolHandlers | undefined) {
    this._transformHandlers = value;
  }
}
