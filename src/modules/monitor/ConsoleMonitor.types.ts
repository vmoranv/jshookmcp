export type ConsoleMessageType =
  | 'log'
  | 'warn'
  | 'error'
  | 'info'
  | 'debug'
  | 'trace'
  | 'dir'
  | 'table';

export interface CdpRemoteObject {
  type: string;
  subtype?: string;
  value?: unknown;
  description?: string;
  objectId?: string;
}

export interface CdpCallFrame {
  functionName?: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
}

export interface CdpStackTrace {
  callFrames?: CdpCallFrame[];
}

export interface RuntimeConsoleApiCalledEvent {
  type: string;
  args: CdpRemoteObject[];
  timestamp: number;
  stackTrace?: CdpStackTrace;
}

export interface ConsoleMessageAddedEvent {
  message: {
    level?: string;
    text: string;
    url?: string;
    line?: number;
    column?: number;
  };
}

export interface RuntimeExceptionDetails {
  text: string;
  exceptionId: number;
  stackTrace?: CdpStackTrace;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  scriptId?: string;
  exception?: {
    description?: string;
  };
}

export interface RuntimeExceptionThrownEvent {
  exceptionDetails: RuntimeExceptionDetails;
}

export interface RuntimeEvaluateResult {
  result: {
    value?: unknown;
  };
  exceptionDetails?: {
    text: string;
  };
}

export interface PlaywrightConsoleMessageLike {
  type(): string;
  text(): string;
}

export interface PlaywrightConsolePageLike {
  on(event: 'console', handler: (msg: PlaywrightConsoleMessageLike) => void): void;
  on(event: 'pageerror', handler: (error: Error) => void): void;
  off(event: 'console', handler: (msg: PlaywrightConsoleMessageLike) => void): void;
  off(event: 'pageerror', handler: (error: Error) => void): void;
}

export interface ConsoleMessage {
  type: ConsoleMessageType | string;
  text: string;
  args?: unknown[];
  timestamp: number;
  stackTrace?: StackFrame[];
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
}

export interface StackFrame {
  functionName: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
}

export interface ExceptionInfo {
  text: string;
  exceptionId: number;
  timestamp: number;
  stackTrace?: StackFrame[];
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  scriptId?: string;
}
