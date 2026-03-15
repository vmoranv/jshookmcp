import { describe, expect, it } from 'vitest';

import { ScriptManager as ImplScriptManager } from '@modules/debugger/ScriptManager.impl';
import { ScriptManager as ClassScriptManager } from '@modules/debugger/ScriptManager.impl.class';

describe('ScriptManager.impl.ts', () => {
  it('re-exports the ScriptManager class from the class module', () => {
    expect(ImplScriptManager).toBe(ClassScriptManager);
  });
});
