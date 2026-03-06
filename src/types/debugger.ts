import type { CollectCodeResult } from '@internal-types/collector';
import type { DeobfuscateResult } from '@internal-types/deobfuscator';
import type { UnderstandCodeResult } from '@internal-types/analysis';
import type { DetectCryptoResult } from '@internal-types/crypto';
import type { HookRecord } from '@internal-types/hook';

export interface ScopeVariable {
  name: string;
  value: unknown;
  type: string;
  scope: 'global' | 'local' | 'with' | 'closure' | 'catch' | 'block' | 'script' | 'eval' | 'module';
  writable?: boolean;
  configurable?: boolean;
  enumerable?: boolean;
  objectId?: string;
}

export interface BreakpointHitEvent {
  breakpointId: string;
  breakpointInfo?: unknown;
  location: {
    scriptId: string;
    lineNumber: number;
    columnNumber: number;
    url?: string;
  };
  callFrames: unknown[];
  timestamp: number;
  variables?: ScopeVariable[];
  reason: string;
}

export type BreakpointHitCallback = (event: BreakpointHitEvent) => void | Promise<void>;

export interface DebuggerSession {
  version: string;
  timestamp: number;
  breakpoints: Array<{
    location: {
      scriptId?: string;
      url?: string;
      lineNumber: number;
      columnNumber?: number;
    };
    condition?: string;
    enabled: boolean;
  }>;
  pauseOnExceptions: 'none' | 'uncaught' | 'all';
  metadata?: {
    url?: string;
    description?: string;
    tags?: string[];
    [key: string]: unknown;
  };
}

export interface GetScopeVariablesOptions {
  callFrameId?: string;
  includeObjectProperties?: boolean;
  maxDepth?: number;
  skipErrors?: boolean;
}

export interface GetScopeVariablesResult {
  success: boolean;
  variables: ScopeVariable[];
  callFrameId: string;
  callFrameInfo?: {
    functionName: string;
    location: string;
  };
  errors?: Array<{
    scope: string;
    error: string;
  }>;
  totalScopes: number;
  successfulScopes: number;
}

export interface Session {
  id: string;
  url: string;
  createdAt: number;
  updatedAt: number;
  data: SessionData;
}

export interface SessionData {
  code?: CollectCodeResult;
  deobfuscated?: DeobfuscateResult;
  analysis?: UnderstandCodeResult;
  crypto?: DetectCryptoResult;
  hooks?: HookRecord[];
}
