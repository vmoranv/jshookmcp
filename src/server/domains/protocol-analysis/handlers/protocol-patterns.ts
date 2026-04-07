import type { ProtocolPattern, StateMachine } from '@modules/protocol-analysis/types';

export interface DefinePatternArgs {
  name: string;
  fields: Array<{
    name: string;
    type: string;
    offset: number;
    length: number;
    description?: string;
  }>;
  byteOrder?: 'big' | 'little';
  encryption?: {
    type: 'aes' | 'xor' | 'rc4' | 'custom';
    key?: string;
    iv?: string;
    notes?: string;
  };
}

export interface DefinePatternResult {
  patternId: string;
  pattern: ProtocolPattern;
}

export interface AutoDetectArgs {
  payloads: string[];
  name?: string;
}

export interface AutoDetectResult {
  patterns: ProtocolPattern[];
}

export interface ExportSchemaArgs {
  patternId: string;
}

export interface ExportSchemaResult {
  schema: string;
}

export interface InferStateMachineArgs {
  messages: Array<{
    direction: 'in' | 'out';
    payloadHex: string;
    timestamp?: number;
  }>;
  simplify?: boolean;
}

export interface InferStateMachineResult {
  stateMachine: StateMachine;
}

export interface VisualizeStateArgs {
  stateMachine: StateMachine;
}

export interface VisualizeStateResult {
  mermaidDiagram: string;
}
