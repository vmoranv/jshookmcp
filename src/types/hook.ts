export interface HookOptions {
  target: string;
  type:
    | 'function'
    | 'xhr'
    | 'fetch'
    | 'websocket'
    | 'localstorage'
    | 'cookie'
    | 'eval'
    | 'object-method';
  action?: 'log' | 'block' | 'modify';
  customCode?: string;
  condition?: HookCondition;
  performance?: boolean;
  regex?: boolean;
}

export interface HookCondition {
  argumentFilter?: (args: unknown[]) => boolean;
  returnFilter?: (result: unknown) => boolean;
  maxCalls?: number;
  minInterval?: number;
  params?: unknown[];
  returnValue?: unknown;
  callCount?: number;
}

export interface HookContext {
  target: string;
  args: unknown[];
  returnValue?: unknown;
  callStack: CallStackFrame[];
  timestamp: number;
}

export interface CallStackFrame {
  functionName: string;
  fileName: string;
  lineNumber: number;
  columnNumber: number;
}

export interface HookResult {
  hookId: string;
  script: string;
  instructions: string;
}

export interface HookRecord {
  hookId: string;
  timestamp: number;
  context: HookContext;
}
