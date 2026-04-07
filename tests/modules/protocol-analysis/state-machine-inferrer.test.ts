import { describe, expect, it } from 'vitest';
import { StateMachineInferrer } from '@modules/protocol-analysis/StateMachineInferrer';

describe('StateMachineInferrer', () => {
  describe('inferStateMachine', () => {
    it('returns empty state machine for no messages', () => {
      const inferrer = new StateMachineInferrer();
      const result = inferrer.inferStateMachine([]);

      expect(result.states).toEqual([]);
      expect(result.transitions).toEqual([]);
      expect(result.initialState).toBe('');
      expect(result.finalStates).toEqual([]);
    });

    it('infers states from simple message sequence', () => {
      const inferrer = new StateMachineInferrer();
      const messages = [
        { direction: 'out' as const, payload: Buffer.from('0100', 'hex') },
        { direction: 'in' as const, payload: Buffer.from('0200', 'hex') },
        { direction: 'out' as const, payload: Buffer.from('0300', 'hex') },
        { direction: 'in' as const, payload: Buffer.from('0400', 'hex') },
      ];

      const result = inferrer.inferStateMachine(messages);

      expect(result.states.length).toBeGreaterThan(0);
      expect(result.initialState).toBeDefined();
    });

    it('identifies similar structures as same state', () => {
      const inferrer = new StateMachineInferrer();
      // Repeated request-response with same structure
      const messages = [
        { direction: 'out' as const, payload: Buffer.from('ab0001', 'hex') },
        { direction: 'in' as const, payload: Buffer.from('cd0001', 'hex') },
        { direction: 'out' as const, payload: Buffer.from('ab0002', 'hex') },
        { direction: 'in' as const, payload: Buffer.from('cd0002', 'hex') },
      ];

      const result = inferrer.inferStateMachine(messages);

      expect(result.states.length).toBeGreaterThan(0);
      expect(result.transitions.length).toBeGreaterThan(0);
    });

    it('generates meaningful state names for small control messages', () => {
      const inferrer = new StateMachineInferrer();
      const messages = [
        { direction: 'out' as const, payload: Buffer.from([0x01]) },
        { direction: 'in' as const, payload: Buffer.from([0x02]) },
      ];

      const result = inferrer.inferStateMachine(messages);

      // Control messages should get descriptive names
      const stateNames = result.states.map((s) => s.name);
      expect(stateNames.some((n) => n.includes('control'))).toBe(true);
    });

    it('detects TLS handshake patterns', () => {
      const inferrer = new StateMachineInferrer();
      const messages = [
        { direction: 'out' as const, payload: Buffer.from([0x16]) },
        { direction: 'in' as const, payload: Buffer.from([0x16]) },
        { direction: 'out' as const, payload: Buffer.from([0x17]) },
      ];

      const result = inferrer.inferStateMachine(messages);

      const stateNames = result.states.map((s) => s.name);
      expect(stateNames.some((n) => n.includes('tls_handshake'))).toBe(true);
    });

    it('detects JSON-like payloads', () => {
      const inferrer = new StateMachineInferrer();
      const messages = [
        { direction: 'out' as const, payload: Buffer.from('{"cmd":"hello"}') },
        { direction: 'in' as const, payload: Buffer.from('{"status":"ok"}') },
      ];

      const result = inferrer.inferStateMachine(messages);

      const stateNames = result.states.map((s) => s.name);
      expect(stateNames.some((n) => n.includes('json'))).toBe(true);
    });

    it('detects text payloads', () => {
      const inferrer = new StateMachineInferrer();
      const messages = [
        { direction: 'out' as const, payload: Buffer.from('GET / HTTP/1.1\r\nHost: test\r\n\r\n') },
      ];

      const result = inferrer.inferStateMachine(messages);

      const stateNames = result.states.map((s) => s.name);
      expect(stateNames.some((n) => n.includes('text'))).toBe(true);
    });

    it('detects encrypted payloads via entropy', () => {
      const inferrer = new StateMachineInferrer();
      // Generate a 256-byte buffer with all possible byte values for high entropy
      const highEntropy = Buffer.alloc(256);
      for (let i = 0; i < 256; i++) {
        highEntropy[i] = i;
      }
      const messages = [{ direction: 'out' as const, payload: highEntropy }];

      const result = inferrer.inferStateMachine(messages);

      const stateNames = result.states.map((s) => s.name);
      expect(stateNames.some((n) => n.includes('encrypted'))).toBe(true);
    });

    it('infers timeouts from timestamped messages', () => {
      const inferrer = new StateMachineInferrer();
      const messages = [
        { direction: 'out' as const, payload: Buffer.from('ab00', 'hex'), timestamp: 1000 },
        { direction: 'in' as const, payload: Buffer.from('ab00', 'hex'), timestamp: 1100 },
        { direction: 'out' as const, payload: Buffer.from('ab00', 'hex'), timestamp: 1200 },
        { direction: 'in' as const, payload: Buffer.from('ab00', 'hex'), timestamp: 1300 },
      ];

      const result = inferrer.inferStateMachine(messages);

      // Should have timeout inferred from timestamps
      const stateWithTimeout = result.states.find((s) => s.timeout !== undefined);
      expect(stateWithTimeout).toBeDefined();
    });

    it('computes confidence scores for transitions', () => {
      const inferrer = new StateMachineInferrer();
      const messages = [
        { direction: 'out' as const, payload: Buffer.from('aa', 'hex') },
        { direction: 'in' as const, payload: Buffer.from('bb', 'hex') },
        { direction: 'out' as const, payload: Buffer.from('cc', 'hex') },
        { direction: 'in' as const, payload: Buffer.from('dd', 'hex') },
      ];

      const result = inferrer.inferStateMachine(messages);

      for (const t of result.transitions) {
        expect(t.confidence).toBeGreaterThanOrEqual(0);
        expect(t.confidence).toBeLessThanOrEqual(1);
      }
    });

    it('handles empty payload messages', () => {
      const inferrer = new StateMachineInferrer();
      const messages = [
        { direction: 'out' as const, payload: Buffer.from('') },
        { direction: 'in' as const, payload: Buffer.from('') },
      ];

      const result = inferrer.inferStateMachine(messages);

      expect(result.states.length).toBeGreaterThan(0);
    });

    it('detects close/fin patterns as final states', () => {
      const inferrer = new StateMachineInferrer();
      const messages = [
        { direction: 'out' as const, payload: Buffer.from('hello') },
        { direction: 'in' as const, payload: Buffer.from('world') },
        { direction: 'out' as const, payload: Buffer.from('close') },
      ];

      const result = inferrer.inferStateMachine(messages);

      // Should identify close as a final state
      expect(result.finalStates.length).toBeGreaterThan(0);
    });

    it('infers HTTP-like handshake cycle', () => {
      const inferrer = new StateMachineInferrer();
      // Simulate HTTP-like: connect -> request -> response -> close
      const messages = [
        { direction: 'out' as const, payload: Buffer.from('CONNECT', 'utf8') },
        { direction: 'in' as const, payload: Buffer.from('OK', 'utf8') },
        { direction: 'out' as const, payload: Buffer.from('GET /api/data HTTP/1.1\r\n', 'utf8') },
        {
          direction: 'in' as const,
          payload: Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n', 'utf8'),
        },
        { direction: 'out' as const, payload: Buffer.from('close', 'utf8') },
      ];

      const result = inferrer.inferStateMachine(messages);

      expect(result.states.length).toBeGreaterThan(0);
      expect(result.transitions.length).toBeGreaterThan(0);
      expect(result.finalStates.length).toBeGreaterThan(0);
    });
  });

  describe('generateMermaid', () => {
    it('returns empty diagram for empty state machine', () => {
      const inferrer = new StateMachineInferrer();
      const result = inferrer.generateMermaid({
        states: [],
        transitions: [],
        initialState: '',
        finalStates: [],
      });

      expect(result).toContain('stateDiagram-v2');
    });

    it('generates valid mermaid state diagram', () => {
      const inferrer = new StateMachineInferrer();
      const sm = {
        states: [
          { id: 's0', name: 'initial' },
          { id: 's1', name: 'processing' },
        ],
        transitions: [{ from: 's0', to: 's1', trigger: 'send', confidence: 1.0 }],
        initialState: 's0',
        finalStates: ['s1'],
      };

      const result = inferrer.generateMermaid(sm);

      expect(result).toContain('stateDiagram-v2');
      expect(result).toContain('[*] --> s0');
      expect(result).toContain('s0 --> s1');
      expect(result).toContain('s1 --> [*]');
      expect(result).toContain('"initial"');
    });

    it('includes transition labels with confidence', () => {
      const inferrer = new StateMachineInferrer();
      const sm = {
        states: [
          { id: 'a', name: 'A' },
          { id: 'b', name: 'B' },
        ],
        transitions: [{ from: 'a', to: 'b', trigger: 'recv', confidence: 0.5 }],
        initialState: 'a',
        finalStates: ['b'],
      };

      const result = inferrer.generateMermaid(sm);

      expect(result).toContain('recv (0.50)');
    });
  });

  describe('simplify', () => {
    it('returns unchanged for small state machines', () => {
      const inferrer = new StateMachineInferrer();
      const sm = {
        states: [{ id: 'a', name: 'A' }],
        transitions: [],
        initialState: 'a',
        finalStates: ['a'],
      };

      const result = inferrer.simplify(sm);
      expect(result.states).toEqual(sm.states);
    });

    it('merges states with same structure signature', () => {
      const inferrer = new StateMachineInferrer();
      const sm = {
        states: [
          { id: 's0', name: 'A', expectedPayload: 'dead0000111122223333444455556666' },
          { id: 's1', name: 'B', expectedPayload: 'dead0000abcdef0123456789abcdef01' },
          { id: 's2', name: 'C', expectedPayload: 'cafe000011223344556677889900aabb' },
        ],
        transitions: [
          { from: 's0', to: 's1', trigger: 'send' },
          { from: 's1', to: 's2', trigger: 'recv' },
        ],
        initialState: 's0',
        finalStates: ['s2'],
      };

      const result = inferrer.simplify(sm);

      // s0 and s1 share the same first 8 hex chars ('dead0000'), should be merged
      expect(result.states.length).toBeLessThan(sm.states.length);
    });

    it('skips self-loops after merge', () => {
      const inferrer = new StateMachineInferrer();
      const sm = {
        states: [
          { id: 's0', name: 'A', expectedPayload: 'aaaa0000111122223333444455556666' },
          { id: 's1', name: 'B', expectedPayload: 'aaaa0000abcdef0123456789abcdef01' },
          { id: 's2', name: 'C', expectedPayload: 'bbbb000011223344556677889900aabb' },
        ],
        transitions: [
          { from: 's0', to: 's1', trigger: 'send' },
          { from: 's1', to: 's2', trigger: 'recv' },
        ],
        initialState: 's0',
        finalStates: ['s2'],
      };

      const result = inferrer.simplify(sm);

      // No self-loops in transitions
      for (const t of result.transitions) {
        expect(t.from).not.toBe(t.to);
      }
    });

    it('returns unchanged when no states can be merged', () => {
      const inferrer = new StateMachineInferrer();
      const sm = {
        states: [
          { id: 's0', name: 'A', expectedPayload: '11110000aaaa' },
          { id: 's1', name: 'B', expectedPayload: '22220000bbbb' },
          { id: 's2', name: 'C', expectedPayload: '33330000cccc' },
        ],
        transitions: [
          { from: 's0', to: 's1', trigger: 'send' },
          { from: 's1', to: 's2', trigger: 'recv' },
        ],
        initialState: 's0',
        finalStates: ['s2'],
      };

      const result = inferrer.simplify(sm);
      expect(result.states.length).toBe(sm.states.length);
    });

    it('updates initialState and finalStates after merge', () => {
      const inferrer = new StateMachineInferrer();
      const sm = {
        states: [
          { id: 's0', name: 'A', expectedPayload: 'face0000111122223333444455556666' },
          { id: 's1', name: 'B', expectedPayload: 'face0000abcdef0123456789abcdef01' },
          { id: 's2', name: 'C', expectedPayload: '11112222aabbccdd' },
        ],
        transitions: [
          { from: 's0', to: 's1', trigger: 'send' },
          { from: 's1', to: 's2', trigger: 'recv' },
        ],
        initialState: 's0',
        finalStates: ['s2'],
      };

      const result = inferrer.simplify(sm);

      // initialState should point to merged primary
      expect(result.initialState).toBeDefined();
      expect(result.finalStates).toHaveLength(1);
    });
  });

  describe('private helpers (via behavior)', () => {
    it('computeStructureSignature: empty buffer', () => {
      const inferrer = new StateMachineInferrer();
      const result = inferrer.inferStateMachine([{ direction: 'out', payload: Buffer.from('') }]);
      expect(result.states.some((s) => s.name === 'send_empty' || s.name.includes('empty'))).toBe(
        true,
      );
    });

    it('generateStateName: text detection via high text ratio', () => {
      const inferrer = new StateMachineInferrer();
      const textPayload = Buffer.from(
        'Hello, this is a normal text message with readable content.',
      );
      const result = inferrer.inferStateMachine([{ direction: 'out', payload: textPayload }]);
      expect(result.states.some((s) => s.name.includes('text'))).toBe(true);
    });
  });
});
