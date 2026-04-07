import { type StateMachine, type State, type Transition } from './types';

/**
 * State machine inference from captured traffic.
 *
 * Groups messages by payload structure similarity, infers states
 * from unique structures, and transitions from direction changes.
 *
 * Pure Node.js — no external dependencies.
 */
export class StateMachineInferrer {
  /**
   * Infer a state machine from a sequence of captured messages.
   */
  inferStateMachine(
    messages: Array<{ direction: 'in' | 'out'; payload: Buffer; timestamp?: number }>,
  ): StateMachine {
    if (messages.length === 0) {
      return { states: [], transitions: [], initialState: '', finalStates: [] };
    }

    // Step 1: Group messages by payload structure signature
    const structureGroups = this.groupByStructure(messages);

    // Step 2: Assign state IDs to each unique structure
    const stateMap = new Map<string, State>();
    const stateOrder: string[] = [];

    for (const [sig, group] of structureGroups.entries()) {
      const stateId = `state_${stateOrder.length}`;
      const firstMsg = group[0];
      if (!firstMsg) continue;
      const stateName = this.generateStateName(firstMsg, sig);

      stateMap.set(sig, {
        id: stateId,
        name: stateName,
        expectedPayload: firstMsg.payload.toString('hex').slice(0, 32),
        timeout: this.inferTimeout(group),
      });
      stateOrder.push(sig);
    }

    // Step 3: Build transitions from message sequence
    const transitions: Transition[] = [];
    const stateCounts: Record<string, number> = {};
    const transitionCounts: Record<string, number> = {};

    let prevStateSig: string | null = null;
    for (let i = 0; i < messages.length; i += 1) {
      const msg = messages[i];
      if (!msg) continue;
      const sig = this.computeStructureSignature(msg.payload);
      const stateId = stateMap.get(sig)?.id ?? `state_unknown_${i}`;

      stateCounts[stateId] = (stateCounts[stateId] ?? 0) + 1;

      if (prevStateSig !== null && prevStateSig !== sig) {
        const prevStateId = stateMap.get(prevStateSig)?.id ?? 'unknown';
        const key = `${prevStateId}->${stateId}`;
        transitionCounts[key] = (transitionCounts[key] ?? 0) + 1;

        transitions.push({
          from: prevStateId,
          to: stateId,
          trigger: msg.direction === 'in' ? 'receive' : 'send',
          confidence: 0,
        });
      }

      prevStateSig = sig;
    }

    // Step 4: Compute confidence scores for transitions
    const totalTransitions = transitions.length;
    for (const t of transitions) {
      const key = `${t.from}->${t.to}`;
      const count = transitionCounts[key] ?? 1;
      t.confidence = Number(Math.min(1, (count / Math.max(1, totalTransitions)) * 2).toFixed(2));
    }

    // Step 5: Deduplicate transitions (keep highest confidence)
    const deduped = new Map<string, Transition>();
    for (const t of transitions) {
      const key = `${t.from}->${t.to}->${t.trigger}`;
      const existing = deduped.get(key);
      if (!existing || (t.confidence ?? 0) > (existing.confidence ?? 0)) {
        deduped.set(key, t);
      }
    }

    // Step 6: Determine initial and final states
    const initialState = stateMap.get(stateOrder[0] ?? '')?.id ?? 'state_0';
    const finalStates = this.identifyFinalStates(messages, stateMap);

    return {
      states: Array.from(stateMap.values()),
      transitions: Array.from(deduped.values()),
      initialState,
      finalStates,
    };
  }

  /**
   * Generate a Mermaid state diagram from a state machine.
   */
  generateMermaid(sm: StateMachine): string {
    if (sm.states.length === 0) {
      return 'stateDiagram-v2\n  [*] --> empty';
    }

    const lines: string[] = ['stateDiagram-v2'];

    // Initial state
    lines.push(`  [*] --> ${sm.initialState}`);

    // Transitions
    for (const t of sm.transitions) {
      const label = t.trigger + (t.confidence !== undefined ? ` (${t.confidence.toFixed(2)})` : '');
      lines.push(`  ${t.from} --> ${t.to} : ${label}`);
    }

    // Final states
    for (const fs of sm.finalStates) {
      lines.push(`  ${fs} --> [*]`);
    }

    // State names as comments
    for (const s of sm.states) {
      lines.push(`  state "${s.name}" as ${s.id}`);
    }

    lines.push('');
    return lines.join('\n');
  }

  /**
   * Simplify a state machine by merging similar states.
   */
  simplify(sm: StateMachine): StateMachine {
    if (sm.states.length <= 2) return sm;

    // Find states with identical structure signatures (same expectedPayload prefix)
    const groups = new Map<string, string[]>();
    for (const s of sm.states) {
      const sig = (s.expectedPayload ?? '').slice(0, 8);
      const arr = groups.get(sig) ?? [];
      arr.push(s.id);
      groups.set(sig, arr);
    }

    // Merge states with same signature
    const mergeMap = new Map<string, string>();
    for (const [, ids] of groups.entries()) {
      if (ids.length > 1) {
        const primary = ids[0] as string;
        for (let i = 1; i < ids.length; i += 1) {
          mergeMap.set(ids[i] as string, primary);
        }
      }
    }

    if (mergeMap.size === 0) return sm;

    // Apply merges
    const newStates = sm.states.filter((s) => !mergeMap.has(s.id));
    const newTransitions: Transition[] = [];

    for (const t of sm.transitions) {
      const from = mergeMap.get(t.from) ?? t.from;
      const to = mergeMap.get(t.to) ?? t.to;

      if (from === to) continue; // Skip self-loops from merge

      newTransitions.push({ ...t, from, to });
    }

    const newFinalStates = sm.finalStates
      .map((f) => mergeMap.get(f) ?? f)
      .filter((f, idx, arr) => arr.indexOf(f) === idx);

    return {
      states: newStates,
      transitions: newTransitions,
      initialState: mergeMap.get(sm.initialState) ?? sm.initialState,
      finalStates: newFinalStates,
    };
  }

  // --- Private helpers ---

  private computeStructureSignature(payload: Buffer): string {
    if (payload.length === 0) return 'empty';

    // Signature: length class + first 4 bytes hex + entropy bucket
    const lenClass = this.lengthClass(payload.length);
    const prefix = payload.subarray(0, Math.min(4, payload.length)).toString('hex');
    const entropyBucket = this.entropyBucket(payload);

    return `${lenClass}_${prefix}_${entropyBucket}`;
  }

  private groupByStructure(
    messages: Array<{ direction: 'in' | 'out'; payload: Buffer; timestamp?: number }>,
  ): Map<string, Array<{ direction: 'in' | 'out'; payload: Buffer; timestamp?: number }>> {
    const groups = new Map<
      string,
      Array<{ direction: 'in' | 'out'; payload: Buffer; timestamp?: number }>
    >();

    for (const msg of messages) {
      const sig = this.computeStructureSignature(msg.payload);
      const arr = groups.get(sig) ?? [];
      arr.push(msg);
      groups.set(sig, arr);
    }

    return groups;
  }

  private generateStateName(
    msg: { direction: 'in' | 'out'; payload: Buffer },
    sig: string,
  ): string {
    const dir = msg.direction === 'out' ? 'send' : 'recv';
    const payload = msg.payload;

    if (payload.length === 0) return `${dir}_empty`;

    // Check for handshake-like patterns
    if (payload.length <= 4) {
      const first = payload[0] as number;
      if (first === 0x16) return 'tls_handshake';
      if (first === 0x17) return 'tls_application_data';
      if (first === 0x01 || first === 0x02 || first === 0x03 || first === 0x04)
        return `${dir}_control`;
    }

    // Check for JSON-like payloads
    const firstByte = payload[0] as number;
    if (firstByte === 0x7b || firstByte === 0x5b) return `${dir}_json`;

    // Check for printable text
    const textRatio = this.textRatio(payload);
    if (textRatio > 0.8) return `${dir}_text`;

    // High entropy = encrypted/compressed
    const entropy = this.computeEntropy(payload);
    if (entropy > 7.5) return `${dir}_encrypted`;

    // Generic
    return `${dir}_${this.lengthClass(payload.length)}_${sig.slice(0, 8)}`;
  }

  private inferTimeout(
    group: Array<{ direction: 'in' | 'out'; payload: Buffer; timestamp?: number }>,
  ): number | undefined {
    if (group.length < 2) return undefined;

    const withTimestamps = group.filter((m) => m.timestamp !== undefined);
    if (withTimestamps.length < 2) return undefined;

    const sorted = [...withTimestamps].toSorted((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i += 1) {
      const gap =
        (sorted[i] as { timestamp: number }).timestamp -
        (sorted[i - 1] as { timestamp: number }).timestamp;
      gaps.push(gap);
    }

    if (gaps.length > 0) {
      return Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
    }
    return undefined;
  }

  private identifyFinalStates(
    messages: Array<{ direction: 'in' | 'out'; payload: Buffer }>,
    stateMap: Map<string, State>,
  ): string[] {
    if (messages.length === 0) return [];

    // States that appear at the end of a conversation (out -> in sequence ending)
    const lastSig = this.computeStructureSignature(
      (messages[messages.length - 1] as { payload: Buffer }).payload,
    );
    const lastState = stateMap.get(lastSig);

    // Also check for close/bye/fin patterns
    const finSignals = new Set<string>();
    for (const msg of messages) {
      const payload = msg.payload;
      if (payload.length >= 2) {
        const str = payload.toString('utf8').toLowerCase();
        if (str.includes('close') || str.includes('bye') || str.includes('fin')) {
          const sig = this.computeStructureSignature(payload);
          const st = stateMap.get(sig);
          if (st) finSignals.add(st.id);
        }
      }
    }

    const finals: string[] = [];
    if (lastState) finals.push(lastState.id);
    for (const f of finSignals) {
      if (!finals.includes(f)) finals.push(f);
    }

    return finals;
  }

  private lengthClass(len: number): string {
    if (len === 0) return 'empty';
    if (len <= 4) return 'tiny';
    if (len <= 16) return 'small';
    if (len <= 64) return 'medium';
    if (len <= 256) return 'large';
    return 'xlarge';
  }

  private entropyBucket(buffer: Buffer): string {
    const e = this.computeEntropy(buffer);
    if (e < 3.0) return 'low';
    if (e < 5.0) return 'mid';
    if (e < 7.0) return 'high';
    return 'vhigh';
  }

  private computeEntropy(buffer: Buffer): number {
    if (buffer.length === 0) return 0;

    const freq: number[] = Array.from({ length: 256 }, () => 0);
    for (const value of buffer.values()) {
      const idx = value as number;
      freq[idx] = (freq[idx] ?? 0) + 1;
    }

    let entropy = 0;
    for (const count of freq) {
      if (count === 0) continue;
      const prob = count / buffer.length;
      entropy -= prob * Math.log2(prob);
    }

    return entropy;
  }

  private textRatio(buffer: Buffer): number {
    if (buffer.length === 0) return 1;
    let textCount = 0;
    for (const value of buffer.values()) {
      if ((value >= 0x20 && value <= 0x7e) || value === 0x0a || value === 0x0d || value === 0x09) {
        textCount += 1;
      }
    }
    return textCount / buffer.length;
  }
}
