/**
 * Hardware Breakpoint types.
 * @module HardwareBreakpoint.types
 */

export type BreakpointAccess = 'read' | 'write' | 'readwrite' | 'execute';
export type BreakpointSize = 1 | 2 | 4 | 8;

export interface BreakpointConfig {
  id: string;
  pid: number;
  address: string;
  access: BreakpointAccess;
  size: BreakpointSize;
  condition?: {
    type: 'value_equals' | 'value_changed' | 'value_greater' | 'value_less';
    value?: string;
    valueType?: string;
  };
  enabled: boolean;
}

export interface BreakpointHit {
  breakpointId: string;
  address: string;
  accessAddress: string;
  instructionAddress: string;
  threadId: number;
  accessType: BreakpointAccess;
  timestamp: number;
  registers?: {
    rax: string;
    rbx: string;
    rcx: string;
    rdx: string;
    rsi: string;
    rdi: string;
    rsp: string;
    rbp: string;
    r8: string;
    r9: string;
    r10: string;
    r11: string;
    r12: string;
    r13: string;
    r14: string;
    r15: string;
    rip: string;
    rflags: string;
  };
}

export interface BreakpointListEntry {
  id: string;
  address: string;
  access: BreakpointAccess;
  size: BreakpointSize;
  enabled: boolean;
  hitCount: number;
  lastHit?: number;
}
