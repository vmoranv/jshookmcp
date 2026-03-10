export type { CodeLocation, Result } from '@internal-types/common';
export type {
  Config,
  LLMConfig,
  PuppeteerConfig,
  MCPConfig,
  CacheConfig,
  PerformanceConfig,
} from '@internal-types/config';
export type { BrowserContext } from '@internal-types/browser';
export type {
  CollectCodeOptions,
  CodeFile,
  CollectCodeResult,
  DependencyGraph,
  DependencyNode,
  DependencyEdge,
} from '@internal-types/collector';
export type {
  ObfuscationType,
  Transformation,
  DeobfuscateOptions,
  DeobfuscateResult,
  DeobfuscateMappingRule,
  DeobfuscateSavedArtifact,
  DeobfuscateBundleModuleSummary,
  DeobfuscateBundleSummary,
} from '@internal-types/deobfuscator';
export type {
  UnderstandCodeOptions,
  UnderstandCodeResult,
  CodeStructure,
  TechStack,
  BusinessLogic,
  DataFlow,
  DataFlowGraph,
  DataFlowNode,
  DataFlowEdge,
  DataSource,
  DataSink,
  TaintPath,
  SecurityRisk,
  FunctionInfo,
  ClassInfo,
  PropertyInfo,
  ModuleInfo,
  CallGraph,
  CallGraphNode,
  CallGraphEdge,
} from '@internal-types/analysis';
export type {
  DetectCryptoOptions,
  DetectCryptoResult,
  CryptoAlgorithm,
  CryptoParameters,
  CryptoLibrary,
} from '@internal-types/crypto';
export type {
  HookOptions,
  HookCondition,
  HookHandler,
  HookContext,
  CallStackFrame,
  HookResult,
  HookRecord,
} from '@internal-types/hook';
export type {
  ScopeVariable,
  BreakpointHitEvent,
  BreakpointHitCallback,
  DebuggerSession,
  GetScopeVariablesOptions,
  GetScopeVariablesResult,
  Session,
  SessionData,
} from '@internal-types/debugger';
export type {
  DetectedEnvironmentVariables,
  MissingAPI,
  EmulationCode,
  EnvironmentEmulatorOptions,
  EnvironmentEmulatorResult,
} from '@internal-types/emulator';
export type {
  VMType,
  InstructionType,
  ComplexityLevel,
  VMInstruction,
  VMFeatures,
  UnresolvedPart,
  JSVMPDeobfuscatorOptions,
  JSVMPDeobfuscatorResult,
} from '@internal-types/vm';
