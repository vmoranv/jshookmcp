export type FieldType = 'int' | 'string' | 'bytes' | 'bool' | 'float';
export type ProtocolFieldType =
  | 'uint8'
  | 'uint16'
  | 'uint32'
  | 'int64'
  | 'float'
  | 'string'
  | 'bytes';

export interface FieldSpec {
  name: string;
  offset: number;
  length: number;
  type: FieldType;
  description?: string;
}

export interface PatternSpec {
  name: string;
  fieldDelimiter?: string;
  byteOrder?: 'le' | 'be';
  fields: FieldSpec[];
}

export interface EncryptionInfo {
  type: 'aes' | 'xor' | 'rc4' | 'custom';
  key?: string;
  iv?: string;
  notes?: string;
}

export interface ProtocolField {
  name: string;
  offset: number;
  length: number;
  type: ProtocolFieldType;
  description?: string;
}

export interface ProtocolPattern {
  name: string;
  fieldDelimiter?: string;
  byteOrder: 'big' | 'little';
  fields: ProtocolField[];
  encryption?: EncryptionInfo;
}

export interface PatternDetectionResult {
  pattern: PatternSpec;
  confidence: number;
  matches: number;
  total: number;
}

export interface ProtocolMessage {
  direction: 'req' | 'res';
  timestamp: number;
  fields: Record<string, unknown>;
  raw: string;
}

export interface StateNode {
  id: string;
  name: string;
  type?: 'normal' | 'accept' | 'reject';
  expectedPayload?: string;
  timeout?: number;
}

export interface StateTransition {
  from: string;
  to: string;
  event?: string;
  trigger?: string;
  condition?: string;
  action?: string;
  confidence?: number;
}

export interface StateMachine {
  states: StateNode[];
  transitions: StateTransition[];
  initial?: string;
  initialState?: string;
  finalStates: string[];
}

export type State = StateNode;
export type Transition = StateTransition;
