import { beforeEach, describe, expect, it } from 'vitest';
import { ProtocolAnalysisHandlers } from '@server/domains/protocol-analysis/handlers';

describe('ProtocolAnalysisHandlers', () => {
  let handlers: ProtocolAnalysisHandlers;

  beforeEach(() => {
    handlers = new ProtocolAnalysisHandlers();
  });

  describe('handleDefinePattern', () => {
    it('defines a pattern and returns patternId', async () => {
      const result = await handlers.handleDefinePattern({
        name: 'test_proto',
        fields: [
          { name: 'magic', type: 'uint16', offset: 0, length: 2 },
          { name: 'data', type: 'string', offset: 2, length: 10 },
        ],
        byteOrder: 'big',
      });

      expect(result.patternId).toBe('test_proto');
      expect(result.pattern.name).toBe('test_proto');
      expect(result.pattern.fields).toHaveLength(2);
    });

    it('uses default name when not provided', async () => {
      const result = await handlers.handleDefinePattern({
        fields: [],
      });

      expect(result.patternId).toBe('unnamed_pattern');
    });

    it('handles empty fields', async () => {
      const result = await handlers.handleDefinePattern({
        name: 'empty',
        fields: [],
      });

      expect(result.pattern.fields).toEqual([]);
    });

    it('applies little endian byte order', async () => {
      const result = await handlers.handleDefinePattern({
        name: 'le',
        fields: [],
        byteOrder: 'little',
      });

      expect(result.pattern.byteOrder).toBe('little');
    });

    it('includes encryption info', async () => {
      const result = await handlers.handleDefinePattern({
        name: 'encrypted',
        fields: [],
        encryption: { type: 'aes', key: 'test', notes: 'AES-256' },
      });

      expect(result.pattern.encryption?.type).toBe('aes');
    });
  });

  describe('handleAutoDetect', () => {
    it('detects pattern from hex payloads', async () => {
      const result = await handlers.handleAutoDetect({
        payloads: ['deadc0de0100', 'deadc0de0200'],
      });

      expect(result.patterns).toHaveLength(1);
      expect(result.patterns[0]?.fields.length).toBeGreaterThan(0);
    });

    it('returns empty fields for no common structure', async () => {
      const result = await handlers.handleAutoDetect({
        payloads: ['aa', 'bb'],
      });

      expect(result.patterns).toHaveLength(1);
    });

    it('handles empty payloads array', async () => {
      const result = await handlers.handleAutoDetect({
        payloads: [],
      });

      expect(result.patterns).toHaveLength(1);
      expect(result.patterns[0]?.fields).toHaveLength(0);
    });

    it('uses optional name', async () => {
      const result = await handlers.handleAutoDetect({
        payloads: ['aabbcc'],
        name: 'custom_name',
      });

      expect(result.patterns[0]?.name).toBe('custom_name');
    });
  });

  describe('handleExportSchema', () => {
    it('exports schema for defined pattern', async () => {
      await handlers.handleDefinePattern({
        name: 'exportable',
        fields: [{ name: 'version', type: 'uint8', offset: 0, length: 1 }],
      });

      const result = await handlers.handleExportSchema({
        patternId: 'exportable',
      });

      expect(result.schema).toContain('message Exportable');
      expect(result.schema).toContain('uint32 version = 1');
    });

    it('returns error for unknown pattern', async () => {
      const result = await handlers.handleExportSchema({
        patternId: 'nonexistent',
      });

      expect(result.schema).toContain('not found');
    });

    it('exports empty pattern', async () => {
      await handlers.handleDefinePattern({
        name: 'empty_proto',
        fields: [],
      });

      const result = await handlers.handleExportSchema({
        patternId: 'empty_proto',
      });

      expect(result.schema).toContain('message EmptyProto');
    });
  });

  describe('handleInferStateMachine', () => {
    it('infers state machine from messages', async () => {
      const result = await handlers.handleInferStateMachine({
        messages: [
          { direction: 'out', payloadHex: '0100', timestamp: 1000 },
          { direction: 'in', payloadHex: '0200', timestamp: 1100 },
          { direction: 'out', payloadHex: '0300', timestamp: 1200 },
        ],
      });

      expect(result.stateMachine.states.length).toBeGreaterThan(0);
      expect(result.stateMachine.initialState).toBeDefined();
    });

    it('handles empty messages', async () => {
      const result = await handlers.handleInferStateMachine({
        messages: [],
      });

      expect(result.stateMachine.states).toEqual([]);
    });

    it('applies simplify option', async () => {
      const messages = [
        { direction: 'out', payloadHex: 'aaaa000011112222', timestamp: 1000 },
        { direction: 'in', payloadHex: 'aaaa0000abcdef01', timestamp: 1100 },
        { direction: 'out', payloadHex: 'bbbb000011223344', timestamp: 1200 },
      ];

      const resultWithoutSimplify = await handlers.handleInferStateMachine({
        messages,
        simplify: false,
      });

      const resultWithSimplify = await handlers.handleInferStateMachine({
        messages,
        simplify: true,
      });

      // Simplified version may have fewer states
      expect(resultWithSimplify.stateMachine.states.length).toBeLessThanOrEqual(
        resultWithoutSimplify.stateMachine.states.length,
      );
    });

    it('handles invalid hex gracefully', async () => {
      const result = await handlers.handleInferStateMachine({
        messages: [
          { direction: 'out', payloadHex: 'invalid' },
          { direction: 'in', payloadHex: 'also_invalid' },
        ],
      });

      // Should still produce a state machine (with empty buffers)
      expect(result.stateMachine).toBeDefined();
    });

    it('infers confidence scores', async () => {
      const result = await handlers.handleInferStateMachine({
        messages: [
          { direction: 'out', payloadHex: 'aa' },
          { direction: 'in', payloadHex: 'bb' },
          { direction: 'out', payloadHex: 'cc' },
        ],
      });

      for (const t of result.stateMachine.transitions) {
        expect(t.confidence).toBeGreaterThanOrEqual(0);
        expect(t.confidence).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('handleVisualizeState', () => {
    it('generates mermaid diagram', async () => {
      const result = await handlers.handleVisualizeState({
        stateMachine: {
          states: [
            { id: 's0', name: 'init' },
            { id: 's1', name: 'process' },
          ],
          transitions: [{ from: 's0', to: 's1', trigger: 'send', confidence: 1.0 }],
          initialState: 's0',
          finalStates: ['s1'],
        },
      });

      expect(result.mermaidDiagram).toContain('stateDiagram-v2');
      expect(result.mermaidDiagram).toContain('[*] --> s0');
      expect(result.mermaidDiagram).toContain('s0 --> s1');
    });

    it('returns empty diagram for undefined state machine', async () => {
      const result = await handlers.handleVisualizeState({});

      expect(result.mermaidDiagram).toContain('stateDiagram-v2');
      expect(result.mermaidDiagram).toContain('[*] --> empty');
    });

    it('returns empty diagram for null state machine', async () => {
      const result = await handlers.handleVisualizeState({
        stateMachine: null,
      });

      expect(result.mermaidDiagram).toContain('[*] --> empty');
    });
  });
});
