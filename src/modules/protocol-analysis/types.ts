export interface ProtocolField {
  name: string;
  type: 'uint8' | 'uint16' | 'uint32' | 'int64' | 'float' | 'string' | 'bytes';
  offset: number;
  length: number;
  description?: string;
}

export interface EncryptionInfo {
  type: 'aes' | 'xor' | 'rc4' | 'custom';
  key?: string;
  iv?: string;
  notes?: string;
}

export interface ProtocolPattern {
  name: string;
  fields: ProtocolField[];
  byteOrder: 'big' | 'little';
  encryption?: EncryptionInfo;
}

export interface State {
  id: string;
  name: string;
  expectedPayload?: string;
  timeout?: number;
}

export interface Transition {
  from: string;
  to: string;
  trigger: string;
  action?: string;
  confidence?: number;
}

export interface StateMachine {
  states: State[];
  transitions: Transition[];
  initialState: string;
  finalStates: string[];
}
