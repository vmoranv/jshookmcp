import { describe, it, expect, vi, beforeEach } from 'vitest';

const exportMocks = vi.hoisted(() => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
  watchManager: vi.fn(),
  xhrManager: vi.fn(),
  eventManager: vi.fn(),
  blackboxManager: vi.fn(),
  sessionManager: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: exportMocks.logger,
}));

vi.mock('@modules/debugger/WatchExpressionManager', () => ({
  WatchExpressionManager: exportMocks.watchManager,
}));

vi.mock('@modules/debugger/XHRBreakpointManager', () => ({
  XHRBreakpointManager: exportMocks.xhrManager,
}));

vi.mock('@modules/debugger/EventBreakpointManager', () => ({
  EventBreakpointManager: exportMocks.eventManager,
}));

vi.mock('@modules/debugger/BlackboxManager', () => ({
  BlackboxManager: exportMocks.blackboxManager,
}));

vi.mock('@modules/debugger/DebuggerSessionManager', () => ({
  DebuggerSessionManager: exportMocks.sessionManager,
}));

import { DebuggerManager as DebuggerManagerImpl } from '@modules/debugger/DebuggerManager.impl';
import { DebuggerManager as DebuggerManagerCore } from '@modules/debugger/DebuggerManager.impl.core';
import { DebuggerManager as DebuggerManagerClass } from '@modules/debugger/DebuggerManager.impl.core.class';
import { ScriptManager as ScriptManagerImpl } from '@modules/debugger/ScriptManager.impl';
import { ScriptManager as ScriptManagerClass } from '@modules/debugger/ScriptManager.impl.class';

describe('debugger internal barrel exports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('re-exports DebuggerManager through impl barrels', () => {
    expect(DebuggerManagerImpl).toBe(DebuggerManagerCore);
    expect(DebuggerManagerCore).toBe(DebuggerManagerClass);
  });

  it('re-exports ScriptManager through impl barrel', () => {
    expect(ScriptManagerImpl).toBe(ScriptManagerClass);
  });
});
