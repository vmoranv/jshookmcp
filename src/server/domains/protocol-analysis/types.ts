// Re-export types from @modules/protocol-analysis. Use direct import syntax (not
// export type {} re-exports) to avoid verbatimModuleSyntax resolution issues with
// type-only exports and aliases.
import type {
  EncryptionInfo,
  FieldSpec,
  PatternSpec,
  ProtocolField,
  ProtocolMessage,
  ProtocolPattern,
  StateMachine,
} from '@modules/protocol-analysis';
export type {
  EncryptionInfo,
  FieldSpec,
  PatternSpec,
  ProtocolField,
  ProtocolMessage,
  ProtocolPattern,
  StateMachine,
};

// Define StateNode and StateTransition locally (verbatimModuleSyntax-safe).
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

// Type aliases for State and Transition.
export type State = StateNode;
export type Transition = StateTransition;
