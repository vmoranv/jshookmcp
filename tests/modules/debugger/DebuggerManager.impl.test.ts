import { describe, expect, it } from 'vitest';

import { DebuggerManager as ImplDebuggerManager } from '@modules/debugger/DebuggerManager.impl';
import { DebuggerManager as CoreDebuggerManager } from '@modules/debugger/DebuggerManager.impl.core';

describe('DebuggerManager.impl.ts', () => {
  it('re-exports the core DebuggerManager class', () => {
    expect(ImplDebuggerManager).toBe(CoreDebuggerManager);
  });
});
