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
  CoreAnalysisHandlers: vi.fn(),
}));

vi.mock('@server/domains/antidebug/index', () => ({
  AntiDebugToolHandlers: vi.fn(),
}));

vi.mock('@server/domains/browser/index', () => ({
  BrowserToolHandlers: vi.fn(),
}));

vi.mock('@server/domains/debugger/index', () => ({
  DebuggerToolHandlers: vi.fn(),
}));

vi.mock('@server/domains/encoding/index', () => ({
  EncodingToolHandlers: vi.fn(),
}));

vi.mock('@server/domains/graphql/index', () => ({
  GraphQLToolHandlers: vi.fn(),
}));

vi.mock('@server/domains/hooks/index', () => ({
  AIHookToolHandlers: vi.fn(),
  HookPresetToolHandlers: vi.fn(),
}));

vi.mock('@server/domains/maintenance/index', () => ({
  CoreMaintenanceHandlers: vi.fn(),
  ExtensionManagementHandlers: vi.fn(),
}));

vi.mock('@server/domains/network/index', () => ({
  AdvancedToolHandlers: vi.fn(),
}));

vi.mock('@server/domains/platform/index', () => ({
  PlatformToolHandlers: vi.fn(),
}));

vi.mock('@server/domains/process/index', () => ({
  ProcessToolHandlers: vi.fn(),
}));

vi.mock('@server/domains/sourcemap/index', () => ({
  SourcemapToolHandlers: vi.fn(),
}));

vi.mock('@server/domains/streaming/index', () => ({
  StreamingToolHandlers: vi.fn(),
}));

vi.mock('@server/domains/transform/index', () => ({
  TransformToolHandlers: vi.fn(),
}));

vi.mock('@server/domains/wasm/index', () => ({
  WasmToolHandlers: vi.fn(),
}));

vi.mock('@server/domains/workflow/index', () => ({
  WorkflowHandlers: vi.fn(),
}));

vi.mock('@server/domains/shared/modules', () => ({
  AdvancedDeobfuscator: vi.fn(),
  CodeAnalyzer: vi.fn(),
  CodeCollector: vi.fn(),
  CryptoDetector: vi.fn(),
  Deobfuscator: vi.fn(),
  HookManager: vi.fn(),
  ObfuscationDetector: vi.fn(),
}));
