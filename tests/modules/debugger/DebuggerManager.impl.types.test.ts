import { describe, expect, it } from 'vitest';

import {
  DebuggerManager as ImplDebuggerManager,
  type BreakpointInfo as ImplBreakpointInfo,
  type CallFrame as ImplCallFrame,
  type ObjectPropertyInfo as ImplObjectPropertyInfo,
  type PausedState as ImplPausedState,
  type Scope as ImplScope,
} from '@modules/debugger/DebuggerManager.impl';
import {
  DebuggerManager as CoreDebuggerManager,
  type BreakpointInfo as CoreBreakpointInfo,
  type CallFrame as CoreCallFrame,
  type ObjectPropertyInfo as CoreObjectPropertyInfo,
  type PausedState as CorePausedState,
  type Scope as CoreScope,
} from '@modules/debugger/DebuggerManager.impl.core';

describe('DebuggerManager.impl.ts re-exports', () => {
  it('re-exports the DebuggerManager class from impl.core', () => {
    expect(ImplDebuggerManager).toBe(CoreDebuggerManager);
  });

  it('re-exports BreakpointInfo type compatible with impl.core', () => {
    const info: ImplBreakpointInfo = {
      breakpointId: 'bp-1',
      location: { lineNumber: 5 },
      enabled: true,
      hitCount: 0,
      createdAt: Date.now(),
    };
    const coreInfo: CoreBreakpointInfo = info;
    expect(coreInfo.breakpointId).toBe('bp-1');
  });

  it('re-exports CallFrame type compatible with impl.core', () => {
    const frame: ImplCallFrame = {
      callFrameId: 'cf-1',
      functionName: 'fn',
      location: { scriptId: 's1', lineNumber: 1, columnNumber: 0 },
      url: '',
      scopeChain: [],
      this: null,
    };
    const coreFrame: CoreCallFrame = frame;
    expect(coreFrame.callFrameId).toBe('cf-1');
  });

  it('re-exports ObjectPropertyInfo type compatible with impl.core', () => {
    const prop: ImplObjectPropertyInfo = { name: 'x', value: 1, type: 'number' };
    const coreProp: CoreObjectPropertyInfo = prop;
    expect(coreProp.name).toBe('x');
  });

  it('re-exports PausedState type compatible with impl.core', () => {
    const state: ImplPausedState = { callFrames: [], reason: 'other', timestamp: 0 };
    const coreState: CorePausedState = state;
    expect(coreState.reason).toBe('other');
  });

  it('re-exports Scope type compatible with impl.core', () => {
    const scope: ImplScope = { type: 'global', object: { type: 'object' } };
    const coreScope: CoreScope = scope;
    expect(coreScope.type).toBe('global');
  });
});
