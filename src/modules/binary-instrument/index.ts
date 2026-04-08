export {
  FridaSession,
  type FridaFunctionInfo,
  type FridaModuleInfo,
  type FridaScriptResult,
  type FridaSessionInfo,
  type FridaSymbolInfo,
} from './FridaSession';
export {
  GhidraAnalyzer,
  type DecompiledFunction,
  type GhidraAnalysisResult,
} from './GhidraAnalyzer';
export { HookCodeGenerator } from './HookCodeGenerator';
export { invokePlugin, getAvailablePlugins } from './ExtensionBridge';
export {
  HookGenerator,
  type HookGeneratorOptions,
  type HookSymbolDescriptor,
} from './HookGenerator';
export { UnidbgRunner } from './UnidbgRunner';
export type {
  ExtensionBridgeConfig,
  ExtensionBridgeResult,
  GhidraAnalysisOutput,
  GhidraFunctionParameter,
  GhidraFunctionSummary,
  HookParameter,
  HookTemplate,
} from './types';
