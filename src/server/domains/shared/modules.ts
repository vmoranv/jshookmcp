export { CodeAnalyzer } from '@modules/analyzer/CodeAnalyzer';
export { CamoufoxBrowserManager } from '@modules/browser/CamoufoxBrowserManager';
export { AICaptchaDetector } from '@modules/captcha/AICaptchaDetector';
// Re-export types for convenience
export type {
  CaptchaType,
  CaptchaProviderHint,
  CaptchaDetectionResult,
  AICaptchaDetectionResult,
  CaptchaDetectionConfig,
} from '@modules/captcha/types';
export { CodeCollector } from '@modules/collector/CodeCollector';
export { DOMInspector } from '@modules/collector/DOMInspector';
export { PageController } from '@modules/collector/PageController';
export { CryptoDetector } from '@modules/crypto/CryptoDetector';
export { ASTOptimizer } from '@modules/deobfuscator/ASTOptimizer';
export { AdvancedDeobfuscator } from '@modules/deobfuscator/AdvancedDeobfuscator';
export { Deobfuscator } from '@modules/deobfuscator/Deobfuscator';
export { ObfuscationDetector } from '@modules/detector/ObfuscationDetector';
export { DebuggerManager } from '@modules/debugger/DebuggerManager';
export { RuntimeInspector } from '@modules/debugger/RuntimeInspector';
export { ScriptManager } from '@modules/debugger/ScriptManager';
export { BlackboxManager } from '@modules/debugger/BlackboxManager';
export { ExternalToolRunner } from '@modules/external/ExternalToolRunner';
export { ToolRegistry } from '@modules/external/ToolRegistry';
export { AIHookGenerator } from '@modules/hook/AIHookGenerator';
export type { AIHookRequest } from '@modules/hook/AIHookGenerator';
export { HookManager } from '@modules/hook/HookManager';
export { ConsoleMonitor } from '@modules/monitor/ConsoleMonitor';
export { PerformanceMonitor } from '@modules/monitor/PerformanceMonitor';
export { MemoryManager, UnifiedProcessManager } from '@modules/process/index';
export { StealthScripts } from '@modules/stealth/StealthScripts';
