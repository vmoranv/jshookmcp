import { describe, expect, it } from 'vitest';

import { DebuggerManager as CoreDebuggerManager } from '@modules/debugger/DebuggerManager.impl.core';
import { DebuggerManager as ClassDebuggerManager } from '@modules/debugger/DebuggerManager.impl.core.class';

describe('DebuggerManager.impl.core.ts', () => {
  it('re-exports the DebuggerManager class from the class module', () => {
    expect(CoreDebuggerManager).toBe(ClassDebuggerManager);
  });
});
