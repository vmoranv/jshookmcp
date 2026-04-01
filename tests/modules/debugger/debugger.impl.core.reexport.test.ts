import { describe, expect, it } from 'vitest';

import {
  DebuggerManager as CoreDebuggerManager,
  type BreakpointInfo as CoreBreakpointInfo,
  type CallFrame as CoreCallFrame,
  type ObjectPropertyInfo as CoreObjectPropertyInfo,
  type PausedState as CorePausedState,
  type Scope as CoreScope,
} from '@modules/debugger/DebuggerManager.impl.core';
import {
  DebuggerManager as ClassDebuggerManager,
  type BreakpointInfo as ClassBreakpointInfo,
  type CallFrame as ClassCallFrame,
  type ObjectPropertyInfo as ClassObjectPropertyInfo,
  type PausedState as ClassPausedState,
  type Scope as ClassScope,
} from '@modules/debugger/DebuggerManager.impl.core.class';

describe('DebuggerManager.impl.core.ts re-exports', () => {
  it('re-exports the DebuggerManager class from the class module', () => {
    expect(CoreDebuggerManager).toBe(ClassDebuggerManager);
  });

  it('exports BreakpointInfo type that is compatible with the class module', () => {
    const info: CoreBreakpointInfo = {
      breakpointId: 'bp-1',
      location: { lineNumber: 10 },
      enabled: true,
      hitCount: 0,
      createdAt: Date.now(),
    };
    const classInfo: ClassBreakpointInfo = info;
    expect(classInfo.breakpointId).toBe('bp-1');
  });

  it('exports CallFrame type that is compatible with the class module', () => {
    const frame: CoreCallFrame = {
      callFrameId: 'cf-1',
      functionName: 'testFunc',
      location: { scriptId: 's1', lineNumber: 5, columnNumber: 0 },
      url: 'https://example.com/test.js',
      scopeChain: [],
      this: {},
    };
    const classFrame: ClassCallFrame = frame;
    expect(classFrame.functionName).toBe('testFunc');
  });

  it('exports ObjectPropertyInfo type that is compatible with the class module', () => {
    const prop: CoreObjectPropertyInfo = {
      name: 'testProp',
      value: 42,
      type: 'number',
    };
    const classProp: ClassObjectPropertyInfo = prop;
    expect(classProp.type).toBe('number');
  });

  it('exports PausedState type that is compatible with the class module', () => {
    const state: CorePausedState = {
      callFrames: [],
      reason: 'breakpoint',
      timestamp: Date.now(),
    };
    const classState: ClassPausedState = state;
    expect(classState.reason).toBe('breakpoint');
  });

  it('exports Scope type that is compatible with the class module', () => {
    const scope: CoreScope = {
      type: 'local',
      object: { type: 'object' },
    };
    const classScope: ClassScope = scope;
    expect(classScope.type).toBe('local');
  });
});
