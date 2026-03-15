import { vi } from 'vitest';

const manifestTestMocks = vi.hoisted(() => ({
  bindByDepKey: vi.fn((_depKey: string, _invoke: (...args: unknown[]) => unknown) => {
    const bindFn = vi.fn();
    return bindFn;
  }),
  ensureBrowserCore: vi.fn(),
  toolLookup: vi.fn((tools: Array<{ name: string }>) => {
    const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));

    return (name: string) => {
      const tool = toolsByName.get(name);
      if (!tool) {
        throw new Error(`Unknown tool: ${name}`);
      }

      return tool;
    };
  }),
}));

vi.mock('@server/domains/shared/registry', () => ({
  bindByDepKey: manifestTestMocks.bindByDepKey,
  ensureBrowserCore: manifestTestMocks.ensureBrowserCore,
  toolLookup: manifestTestMocks.toolLookup,
}));

vi.mock('@server/domains/analysis/index', () => ({
  CoreAnalysisHandlers: class CoreAnalysisHandlers {},
}));

vi.mock('@server/domains/antidebug/index', () => ({
  AntiDebugToolHandlers: class AntiDebugToolHandlers {},
}));

vi.mock('@server/domains/browser/index', () => ({
  BrowserToolHandlers: class BrowserToolHandlers {},
}));

vi.mock('@server/domains/debugger/index', () => ({
  DebuggerToolHandlers: class DebuggerToolHandlers {},
}));

vi.mock('@server/domains/encoding/index', () => ({
  EncodingToolHandlers: class EncodingToolHandlers {},
}));

vi.mock('@server/domains/graphql/index', () => ({
  GraphQLToolHandlers: class GraphQLToolHandlers {},
}));

vi.mock('@server/domains/hooks/index', () => ({
  AIHookToolHandlers: class AIHookToolHandlers {},
  HookPresetToolHandlers: class HookPresetToolHandlers {},
}));

vi.mock('@server/domains/maintenance/index', () => ({
  CoreMaintenanceHandlers: class CoreMaintenanceHandlers {},
  ExtensionManagementHandlers: class ExtensionManagementHandlers {},
}));

vi.mock('@server/domains/network/index', () => ({
  AdvancedToolHandlers: class AdvancedToolHandlers {},
}));

vi.mock('@server/domains/platform/index', () => ({
  PlatformToolHandlers: class PlatformToolHandlers {},
}));

vi.mock('@server/domains/process/index', () => ({
  ProcessToolHandlers: class ProcessToolHandlers {},
}));

vi.mock('@server/domains/sourcemap/index', () => ({
  SourcemapToolHandlers: class SourcemapToolHandlers {},
}));

vi.mock('@server/domains/streaming/index', () => ({
  StreamingToolHandlers: class StreamingToolHandlers {},
}));

vi.mock('@server/domains/transform/index', () => ({
  TransformToolHandlers: class TransformToolHandlers {},
}));

vi.mock('@server/domains/wasm/index', () => ({
  WasmToolHandlers: class WasmToolHandlers {},
}));

vi.mock('@server/domains/workflow/index', () => ({
  WorkflowHandlers: class WorkflowHandlers {},
}));

vi.mock('@server/domains/shared/modules', () => ({
  AdvancedDeobfuscator: class AdvancedDeobfuscator {},
  CodeAnalyzer: class CodeAnalyzer {},
  CodeCollector: class CodeCollector {},
  CryptoDetector: class CryptoDetector {},
  Deobfuscator: class Deobfuscator {},
  HookManager: class HookManager {},
  ObfuscationDetector: class ObfuscationDetector {},
}));
