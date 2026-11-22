import { describe, expect, it } from 'vitest';
import { CodeAnalyzer } from '@modules/analyzer/CodeAnalyzer';
import { DebuggerManager } from '@modules/debugger/DebuggerManager';
import * as CollectorModules from '@server/domains/shared/modules/collector';
import * as NativeModules from '@server/domains/shared/modules/native';

describe('shared modules', () => {
  it('should export core modules from their concrete paths', () => {
    expect(CodeAnalyzer).toBeDefined();
    expect(DebuggerManager).toBeDefined();
  });

  it('should export collector modules via sub-barrel', () => {
    expect(CollectorModules.DOMInspector).toBeDefined();
    expect(CollectorModules.CodeCollector).toBeDefined();
    expect(CollectorModules.PageController).toBeDefined();
    expect(CollectorModules.ConsoleMonitor).toBeDefined();
  });

  it('should export native modules via sub-barrel', () => {
    expect(NativeModules.MemoryManager).toBeDefined();
    expect(NativeModules.UnifiedProcessManager).toBeDefined();
  });
});
