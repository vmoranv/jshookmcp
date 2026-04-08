import type { ProtocolMessage, StateMachine, StateNode, StateTransition } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function calculateEntropy(buffer: Buffer): number {
  if (buffer.length === 0) {
    return 0;
  }
  const frequency = new Map<number, number>();
  for (const byte of buffer) {
    frequency.set(byte, (frequency.get(byte) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of frequency.values()) {
    const p = count / buffer.length;
    if (p > 0) {
      entropy -= p * Math.log2(p);
    }
  }
  return entropy;
}

function printableRatioOf(value: string): number {
  if (value.length === 0) {
    return 0;
  }
  let count = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0x20 && code <= 0x7e) {
      count += 1;
    }
  }
  return count / value.length;
}

interface InternalProtocolMessage extends ProtocolMessage {
  _rawBuffer?: Buffer;
}

export class StateMachineInferrer {
  infer(messages: ProtocolMessage[]): StateMachine {
    if (messages.length === 0) {
      return { states: [], transitions: [], initial: '', initialState: '', finalStates: [] };
    }

    const statesBySignature = new Map<string, StateNode>();
    const transitionsByKey = new Map<string, StateTransition>();
    let previousStateId = '';

    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      if (!message) {
        continue;
      }

      const signature = this.buildSignature(message);
      let state = statesBySignature.get(signature);
      if (!state) {
        state = {
          id: `state_${statesBySignature.size + 1}`,
          name: this.buildStateName(message as InternalProtocolMessage, statesBySignature.size + 1),
          type: this.inferStateType(message, index === messages.length - 1),
        };
        statesBySignature.set(signature, state);
      } else {
        state.type = this.mergeStateTypes(
          state.type,
          this.inferStateType(message, index === messages.length - 1),
        );
      }

      // Infer timeout from timestamps
      if (previousStateId && message.timestamp !== undefined) {
        const firstMessage = messages[0];
        if (firstMessage && firstMessage.timestamp !== undefined) {
          state.timeout = message.timestamp - firstMessage.timestamp;
        }
      }

      if (previousStateId) {
        const event = this.buildEventName(message);
        const condition = this.buildCondition(message.fields);
        const action = this.buildAction(message);
        const transitionKey = `${previousStateId}:${state.id}:${event}`;
        if (!transitionsByKey.has(transitionKey)) {
          transitionsByKey.set(transitionKey, {
            from: previousStateId,
            to: state.id,
            event,
            confidence: this.computeTransitionConfidence(message),
            ...(condition ? { condition } : {}),
            ...(action ? { action } : {}),
          });
        }
      }

      previousStateId = state.id;
    }

    const firstMessage = messages[0];
    const initial = firstMessage
      ? (statesBySignature.get(this.buildSignature(firstMessage))?.id ?? '')
      : '';

    return {
      states: [...statesBySignature.values()],
      transitions: [...transitionsByKey.values()],
      initial,
      initialState: initial,
      finalStates: this.collectTerminalStates([...statesBySignature.values()]),
    };
  }

  visualize(machine: StateMachine): string {
    if (machine.states.length === 0) {
      return ['```mermaid', 'stateDiagram-v2', '  [*] --> empty', '```'].join('\n');
    }

    const lines: string[] = ['```mermaid', 'stateDiagram-v2'];
    const initial = machine.initialState ?? machine.initial;
    if (initial) {
      lines.push(`  [*] --> ${initial}`);
    }

    for (const state of machine.states) {
      const stateType = state.type ?? 'normal';
      const label = stateType === 'normal' ? state.name : `${state.name} (${stateType})`;
      lines.push(`  state "${label}" as ${state.id}`);
    }

    for (const transition of machine.transitions) {
      const event = transition.event ?? transition.trigger ?? 'transition';
      const parts = [event];
      if (typeof transition.confidence === 'number') {
        parts.push(`(${transition.confidence.toFixed(2)})`);
      }
      if (transition.condition) {
        parts.push(`[${transition.condition}]`);
      }
      if (transition.action) {
        parts.push(`/ ${transition.action}`);
      }

      lines.push(`  ${transition.from} --> ${transition.to} : ${parts.join(' ')}`);
    }

    const finalStateSet = new Set(machine.finalStates ?? []);
    for (const state of machine.states) {
      const stateType = state.type ?? 'normal';
      if (stateType === 'accept' || stateType === 'reject' || finalStateSet.has(state.id)) {
        lines.push(`  ${state.id} --> [*]`);
      }
    }

    lines.push('```');
    return lines.join('\n');
  }

  inferStateMachine(
    messages: Array<{ direction: 'in' | 'out'; payload: Buffer; timestamp?: number }>,
  ): StateMachine {
    const normalizedMessages: InternalProtocolMessage[] = messages.map((message) => ({
      direction: message.direction === 'out' ? 'req' : 'res',
      timestamp: message.timestamp ?? 0,
      fields: {},
      raw:
        message.payload.length > 0
          ? message.payload.toString('utf8')
          : message.payload.toString('hex'),
      _rawBuffer: message.payload,
    }));

    return this.infer(normalizedMessages);
  }

  generateMermaid(machine: StateMachine): string {
    return this.visualize(machine);
  }

  simplify(machine: StateMachine): StateMachine {
    if (machine.states.length < 2) {
      return {
        ...machine,
        initialState: machine.initialState ?? machine.initial,
        finalStates: machine.finalStates ?? this.collectTerminalStates(machine.states),
      };
    }

    // Group states by hex payload prefix similarity
    const stateToGroup = new Map<string, string>();
    const groupRepresentative = new Map<string, string>();

    for (const state of machine.states) {
      const prefix = this.getPayloadPrefix(state);
      if (!prefix) continue;

      const existingGroup = [...groupRepresentative.entries()].find(
        ([key]) => key === prefix,
      );
      if (existingGroup) {
        stateToGroup.set(state.id, existingGroup[0]);
      } else {
        groupRepresentative.set(prefix, state.id);
        stateToGroup.set(state.id, prefix);
      }
    }

    // Build merge map: non-primary states map to primary
    const mergeMap = new Map<string, string>();
    const groupIdToPrimary = new Map<string, string>();
    for (const [prefix, primaryId] of groupRepresentative) {
      groupIdToPrimary.set(prefix, primaryId);
    }

    for (const state of machine.states) {
      const prefix = this.getPayloadPrefix(state);
      if (!prefix) continue;
      const primary = groupIdToPrimary.get(prefix);
      if (primary && primary !== state.id) {
        mergeMap.set(state.id, primary);
      }
    }

    if (mergeMap.size === 0) {
      return {
        ...machine,
        initialState: machine.initialState ?? machine.initial,
        finalStates: machine.finalStates ?? this.collectTerminalStates(machine.states),
      };
    }

    // Build new states and transitions
    const newStates = machine.states.filter((state) => !mergeMap.has(state.id));
    const newTransitions = machine.transitions
      .map((t) => ({
        ...t,
        from: mergeMap.get(t.from) ?? t.from,
        to: mergeMap.get(t.to) ?? t.to,
      }))
      .filter((t) => t.from !== t.to);

    const rawInitialState = machine.initialState ?? machine.initial ?? '';
    const initialState = mergeMap.get(rawInitialState) ?? rawInitialState;

    const finalStates = machine.finalStates
      .map((fs) => mergeMap.get(fs) ?? fs)
      .filter((fs, index, arr) => arr.indexOf(fs) === index);

    return {
      states: newStates,
      transitions: newTransitions,
      initial: initialState,
      initialState,
      finalStates,
    };
  }

  private getPayloadPrefix(state: StateNode): string | null {
    const payload = state.expectedPayload;
    if (!payload || payload.length < 8) {
      return null;
    }
    return payload.slice(0, 8).toLowerCase();
  }

  private buildSignature(message: ProtocolMessage): string {
    const fieldKeys = Object.keys(message.fields).toSorted().join(',');
    const raw = (message as InternalProtocolMessage)._rawBuffer
      ? (message as InternalProtocolMessage)._rawBuffer!.toString('hex')
      : message.raw;
    const rawPrefix = normalizeText(raw).slice(0, 24);
    return `${message.direction}|${fieldKeys}|${rawPrefix}`;
  }

  private buildStateName(message: InternalProtocolMessage, position: number): string {
    const directionName = message.direction === 'req' ? 'send' : 'recv';
    const primaryField = this.findPrimaryFieldName(message.fields);
    const raw = message.raw;

    // Detect empty payload
    if (raw.length === 0) {
      return `${directionName}_empty`;
    }

    const buf = message._rawBuffer;
    const hexContent = Buffer.isBuffer(buf) ? buf.toString('hex') : raw;

    // Detect TLS handshake (0x16 = handshake, 0x15 = alert, 0x17 = application_data)
    if (hexContent.startsWith('16') || hexContent.startsWith('15') || hexContent.startsWith('17')) {
      return `${directionName}_tls_handshake`;
    }

    // Detect JSON
    const trimmed = raw.trimStart();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return `${directionName}_json_${primaryField || `step_${position}`}`;
    }

    // Detect text (high printable ratio, or mostly printable + common whitespace)
    const ratio = printableRatioOf(raw);
    if (ratio >= 0.7) {
      const lower = normalizeText(raw);
      if (lower.includes('close') || lower.includes('fin') || lower.includes('bye')) {
        return `${directionName}_close`;
      }
      if (lower.startsWith('get ') || lower.startsWith('post ') || lower.startsWith('http')) {
        return `${directionName}_text_http`;
      }
      return `${directionName}_text_${primaryField || `step_${position}`}`;
    }

    // Detect encrypted (high entropy, large buffer)
    if (Buffer.isBuffer(buf) && buf.length >= 32) {
      const entropy = calculateEntropy(buf);
      if (entropy > 6.0) {
        return `${directionName}_encrypted`;
      }
    }

    // Detect small control messages
    if (Buffer.isBuffer(buf) && buf.length <= 4) {
      return `${directionName}_control`;
    }

    return `${directionName}_${primaryField || `step_${position}`}`;
  }

  private findPrimaryFieldName(fields: Record<string, unknown>): string {
    const keys = Object.keys(fields).toSorted();
    const firstKey = keys[0];
    return firstKey ? firstKey : '';
  }

  private inferStateType(message: ProtocolMessage, isLastMessage: boolean): StateNode['type'] {
    const text = normalizeText(message.raw);
    const statusValue = this.findStatusValue(message.fields);

    if (this.containsRejectSignal(text) || this.containsRejectSignal(statusValue)) {
      return 'reject';
    }

    if (
      this.containsAcceptSignal(text) ||
      this.containsAcceptSignal(statusValue) ||
      (isLastMessage && message.direction === 'res')
    ) {
      return 'accept';
    }

    return 'normal';
  }

  private mergeStateTypes(current: StateNode['type'], next: StateNode['type']): StateNode['type'] {
    if (current === 'reject' || next === 'reject') {
      return 'reject';
    }

    if (current === 'accept' || next === 'accept') {
      return 'accept';
    }

    return 'normal';
  }

  private findStatusValue(fields: Record<string, unknown>): string {
    const candidateKeys = ['status', 'result', 'code', 'reason', 'message'];
    for (const key of candidateKeys) {
      const value = fields[key];
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
      }
    }

    return '';
  }

  private containsRejectSignal(value: string): boolean {
    return ['error', 'fail', 'denied', 'reject', 'timeout', 'invalid'].some((token) =>
      normalizeText(value).includes(token),
    );
  }

  private containsAcceptSignal(value: string): boolean {
    return ['ok', 'success', 'accept', 'ready', 'done', 'complete'].some((token) =>
      normalizeText(value).includes(token),
    );
  }

  private buildEventName(message: ProtocolMessage): string {
    const statusValue = this.findStatusValue(message.fields);
    if (statusValue) {
      return `${message.direction}_${normalizeText(statusValue).replace(/[^a-z0-9]+/g, '_')}`;
    }

    const primaryField = this.findPrimaryFieldName(message.fields);
    if (primaryField) {
      return `${message.direction}_${primaryField}`;
    }

    return `${message.direction}_message`;
  }

  private buildCondition(fields: Record<string, unknown>): string | undefined {
    const statusValue = this.findStatusValue(fields);
    if (statusValue) {
      return `status=${statusValue}`;
    }

    const keys = Object.keys(fields).toSorted().slice(0, 2);
    if (keys.length === 0) {
      return undefined;
    }

    const fragments: string[] = [];
    for (const key of keys) {
      const value = fields[key];
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        fragments.push(`${key}=${value}`);
      }
    }

    return fragments.length > 0 ? fragments.join(', ') : undefined;
  }

  private buildAction(message: ProtocolMessage): string | undefined {
    const statusValue = this.findStatusValue(message.fields);
    if (this.containsRejectSignal(statusValue) || this.containsRejectSignal(message.raw)) {
      return 'reject';
    }

    if (this.containsAcceptSignal(statusValue) || this.containsAcceptSignal(message.raw)) {
      return 'complete';
    }

    const rawText = normalizeText(message.raw);
    if (rawText.includes('ack')) {
      return 'acknowledge';
    }

    if (rawText.includes('retry')) {
      return 'retry';
    }

    if (Object.keys(message.fields).length > 0 && isRecord(message.fields)) {
      return message.direction === 'req' ? 'send' : 'receive';
    }

    return undefined;
  }

  private collectTerminalStates(states: StateNode[]): string[] {
    const terminalIds = states
      .filter((state) => {
        const stateType = state.type ?? 'normal';
        return stateType === 'accept' || stateType === 'reject';
      })
      .map((state) => state.id);

    // Also check for close/fin states
    for (const state of states) {
      const lower = normalizeText(state.name);
      if (lower.includes('close') || lower.includes('fin') || lower.includes('bye')) {
        if (!terminalIds.includes(state.id)) {
          terminalIds.push(state.id);
        }
      }
    }

    return terminalIds;
  }

  private computeTransitionConfidence(message: ProtocolMessage): number {
    let confidence = 0.3;

    if (Object.keys(message.fields).length > 0) {
      confidence += 0.3;
    }

    const statusValue = this.findStatusValue(message.fields);
    if (statusValue) {
      confidence += 0.2;
    }

    if (message.raw.length > 0) {
      confidence += 0.2;
    }

    return Math.min(confidence, 1.0);
  }
}
