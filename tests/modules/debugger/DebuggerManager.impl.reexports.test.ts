import { describe, expect, it } from 'vitest';

import { DebuggerManager as ImplDebuggerManager } from '@modules/debugger/DebuggerManager.impl';
import { DebuggerManager as CoreDebuggerManager } from '@modules/debugger/DebuggerManager.impl.core';
import { DebuggerManager as PublicDebuggerManager } from '@modules/debugger/DebuggerManager';
import { ScriptManager as ImplScriptManager } from '@modules/debugger/ScriptManager.impl';
import { ScriptManager as ClassScriptManager } from '@modules/debugger/ScriptManager.impl.class';
import { ScriptManager as PublicScriptManager } from '@modules/debugger/ScriptManager';

describe('Debugger internal re-exports', () => {
  it('re-exports debugger and script manager classes through internal wrapper files', () => {
    expect(ImplDebuggerManager).toBe(CoreDebuggerManager);
    expect(PublicDebuggerManager).toBe(CoreDebuggerManager);
    expect(ImplScriptManager).toBe(ClassScriptManager);
    expect(PublicScriptManager).toBe(ClassScriptManager);
  });
});
