export interface V8HeapObjectInput {
  address: string;
  size: number;
  type: string;
  name: string;
}

export interface NetworkRequestInput {
  url: string;
  method: string;
  headers?: Record<string, string>;
}

export interface CanvasNodeInput {
  nodeId: string;
  type: string;
  label: string;
}

export interface SyscallEventInput {
  syscall: string;
  pid: number;
  timestamp: number;
}

export interface MojoMessageInput {
  interfaceName: string;
  messageType: string;
  payload: unknown;
}

export interface BinarySymbolInput {
  name: string;
  address: string;
  module: string;
}
