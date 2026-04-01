import { describe, expect, it } from 'vitest';

import {
  DebuggerManager as PublicDebuggerManager,
  type BreakpointInfo as PublicBreakpointInfo,
  type PausedState as PublicPausedState,
  type CallFrame as PublicCallFrame,
  type Scope as PublicScope,
  type ObjectPropertyInfo as PublicObjectPropertyInfo,
} from '@modules/debugger/DebuggerManager';
import {
  DebuggerManager as ImplDebuggerManager,
  type BreakpointInfo as ImplBreakpointInfo,
  type PausedState as ImplPausedState,
  type CallFrame as ImplCallFrame,
  type Scope as ImplScope,
  type ObjectPropertyInfo as ImplObjectPropertyInfo,
} from '@modules/debugger/DebuggerManager.impl';

describe('DebuggerManager.ts public re-exports', () => {
  it('re-exports the DebuggerManager class from the impl module', () => {
    expect(PublicDebuggerManager).toBe(ImplDebuggerManager);
  });

  it('exports BreakpointInfo type compatible with impl', () => {
    const bp: PublicBreakpointInfo = {
      breakpointId: 'bp-1',
      location: { lineNumber: 0, scriptId: 's-1', url: 'test.js' },
      condition: 'x > 0',
      enabled: true,
      hitCount: 5,
      createdAt: Date.now(),
    };
    const implBp: ImplBreakpointInfo = bp;
    expect(implBp.condition).toBe('x > 0');
    expect(implBp.hitCount).toBe(5);
  });

  it('exports PausedState type compatible with impl', () => {
    const state: PublicPausedState = {
      callFrames: [],
      reason: 'exception',
      data: { text: 'TypeError' },
      hitBreakpoints: ['bp-1'],
      timestamp: Date.now(),
    };
    const implState: ImplPausedState = state;
    expect(implState.reason).toBe('exception');
    expect(implState.hitBreakpoints).toEqual(['bp-1']);
  });

  it('exports CallFrame type compatible with impl', () => {
    const frame: PublicCallFrame = {
      callFrameId: 'cf-1',
      functionName: 'anonymous',
      location: { scriptId: 's-1', lineNumber: 10, columnNumber: 5 },
      url: 'https://example.com/app.js',
      scopeChain: [
        {
          type: 'local',
          object: { type: 'object', objectId: 'obj-1', className: 'Object' },
        },
      ],
      this: { value: 42 },
    };
    const implFrame: ImplCallFrame = frame;
    expect(implFrame.scopeChain).toHaveLength(1);
  });

  it('exports Scope type with all valid scope types', () => {
    const validTypes: Array<PublicScope['type']> = [
      'global',
      'local',
      'with',
      'closure',
      'catch',
      'block',
      'script',
      'eval',
      'module',
    ];
    for (const scopeType of validTypes) {
      const scope: PublicScope = {
        type: scopeType,
        object: { type: 'object' },
      };
      const implScope: ImplScope = scope;
      expect(implScope.type).toBe(scopeType);
    }
  });

  it('exports ObjectPropertyInfo type with optional fields', () => {
    const minimal: PublicObjectPropertyInfo = { name: 'a', value: null, type: 'null' };
    const full: PublicObjectPropertyInfo = {
      name: 'b',
      value: { nested: true },
      type: 'object',
      objectId: 'obj-1',
      className: 'MyClass',
      description: 'MyClass {}',
    };
    const implMinimal: ImplObjectPropertyInfo = minimal;
    const implFull: ImplObjectPropertyInfo = full;
    expect(implMinimal.objectId).toBeUndefined();
    expect(implFull.className).toBe('MyClass');
  });
});
