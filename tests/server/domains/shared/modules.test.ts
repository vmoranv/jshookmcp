import { describe, expect, it } from 'vitest';
import * as Modules from '@server/domains/shared/modules';

describe('shared/modules', () => {
  it('should export all shared modules properly', () => {
    expect(Modules.CodeAnalyzer).toBeDefined();
    expect(Modules.DOMInspector).toBeDefined();
    expect(Modules.DebuggerManager).toBeDefined();
    expect(Modules.MemoryManager).toBeDefined();
  });
});
