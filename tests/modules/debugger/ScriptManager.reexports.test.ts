import { describe, expect, it } from 'vitest';

import {
  ScriptManager as PublicScriptManager,
  type ScriptInfo as PublicScriptInfo,
} from '@modules/debugger/ScriptManager';
import {
  ScriptManager as ImplScriptManager,
  type ScriptInfo as ImplScriptInfo,
} from '@modules/debugger/ScriptManager.impl';

describe('ScriptManager.ts public re-exports', () => {
  it('re-exports the ScriptManager class from the impl module', () => {
    expect(PublicScriptManager).toBe(ImplScriptManager);
  });

  it('exports ScriptInfo type compatible with impl', () => {
    const minimal: PublicScriptInfo = {
      scriptId: 's-1',
      url: 'https://example.com/app.js',
      startLine: 0,
      startColumn: 0,
      endLine: 100,
      endColumn: 0,
    };
    const implMinimal: ImplScriptInfo = minimal;
    expect(implMinimal.scriptId).toBe('s-1');
    expect(implMinimal.sourceLength).toBeUndefined();
    expect(implMinimal.source).toBeUndefined();
  });

  it('exports ScriptInfo type with optional source fields', () => {
    const full: PublicScriptInfo = {
      scriptId: 's-2',
      url: 'https://example.com/vendor.js',
      startLine: 0,
      startColumn: 0,
      endLine: 500,
      endColumn: 0,
      sourceLength: 12345,
      source: 'function hello() { return "world"; }',
    };
    const implFull: ImplScriptInfo = full;
    expect(implFull.sourceLength).toBe(12345);
    expect(implFull.source).toContain('hello');
  });
});
