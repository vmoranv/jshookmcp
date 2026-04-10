import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LLMDeobfuscator } from '@modules/deobfuscator/LLMDeobfuscator';
import type { LLMSamplingBridge } from '@server/LLMSamplingBridge';

function createMockBridge(supported: boolean, response?: string | null): LLMSamplingBridge {
  return {
    isSamplingSupported: vi.fn(() => supported),
    sampleText: vi.fn(async () => response ?? null),
  } as unknown as LLMSamplingBridge;
}

describe('LLMDeobfuscator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isAvailable', () => {
    it('returns true when bridge supports sampling', () => {
      const bridge = createMockBridge(true);
      const deob = new LLMDeobfuscator(bridge);
      expect(deob.isAvailable()).toBe(true);
    });

    it('returns false when bridge does not support sampling', () => {
      const bridge = createMockBridge(false);
      const deob = new LLMDeobfuscator(bridge);
      expect(deob.isAvailable()).toBe(false);
    });
  });

  describe('suggestVariableNames', () => {
    it('returns null when sampling is unavailable', async () => {
      const bridge = createMockBridge(false);
      const deob = new LLMDeobfuscator(bridge);
      const result = await deob.suggestVariableNames('var _0x1a = 42;', ['_0x1a']);
      expect(result).toBeNull();
      expect(bridge.sampleText).not.toHaveBeenCalled();
    });

    it('parses valid JSON response with name suggestions', async () => {
      const llmResponse = JSON.stringify([
        { original: '_0x1a2b', suggested: 'userId', confidence: 'high' },
        { original: '_0x3c4d', suggested: 'counter', confidence: 'medium' },
      ]);
      const bridge = createMockBridge(true, llmResponse);
      const deob = new LLMDeobfuscator(bridge);

      const result = await deob.suggestVariableNames('var _0x1a2b = getData(); _0x3c4d++;', [
        '_0x1a2b',
        '_0x3c4d',
      ]);

      expect(result).toHaveLength(2);
      expect(result![0]).toEqual({
        original: '_0x1a2b',
        suggested: 'userId',
        confidence: 'high',
      });
      expect(result![1]).toEqual({
        original: '_0x3c4d',
        suggested: 'counter',
        confidence: 'medium',
      });
    });

    it('handles markdown-wrapped JSON response', async () => {
      const llmResponse =
        '```json\n[{"original": "_0xab", "suggested": "result", "confidence": "low"}]\n```';
      const bridge = createMockBridge(true, llmResponse);
      const deob = new LLMDeobfuscator(bridge);

      const result = await deob.suggestVariableNames('return _0xab;', ['_0xab']);
      expect(result).toHaveLength(1);
      expect(result![0]!.suggested).toBe('result');
    });

    it('filters out identifiers not in the expected list', async () => {
      const llmResponse = JSON.stringify([
        { original: '_0xab', suggested: 'result', confidence: 'high' },
        { original: '_0xUnexpected', suggested: 'extra', confidence: 'high' },
      ]);
      const bridge = createMockBridge(true, llmResponse);
      const deob = new LLMDeobfuscator(bridge);

      const result = await deob.suggestVariableNames('return _0xab;', ['_0xab']);
      expect(result).toHaveLength(1);
      expect(result![0]!.original).toBe('_0xab');
    });

    it('returns empty array for malformed JSON response', async () => {
      const bridge = createMockBridge(true, 'This is not valid JSON');
      const deob = new LLMDeobfuscator(bridge);

      const result = await deob.suggestVariableNames('x = 1;', ['x']);
      expect(result).toEqual([]);
    });

    it('returns null when sampleText returns null', async () => {
      const bridge = createMockBridge(true, null);
      const deob = new LLMDeobfuscator(bridge);

      const result = await deob.suggestVariableNames('x = 1;', ['x']);
      expect(result).toBeNull();
    });

    it('truncates identifiers to max limit', async () => {
      const bridge = createMockBridge(true, '[]');
      const deob = new LLMDeobfuscator(bridge);

      const manyIds = Array.from({ length: 50 }, (_, i) => `_0x${i}`);
      await deob.suggestVariableNames('code', manyIds);

      expect(bridge.sampleText).toHaveBeenCalledWith(
        expect.objectContaining({
          userMessage: expect.not.stringContaining('_0x20'),
        }),
      );
    });

    it('defaults unrecognized confidence to low', async () => {
      const llmResponse = JSON.stringify([
        { original: '_0xab', suggested: 'result', confidence: 'very_high' },
      ]);
      const bridge = createMockBridge(true, llmResponse);
      const deob = new LLMDeobfuscator(bridge);

      const result = await deob.suggestVariableNames('return _0xab;', ['_0xab']);
      expect(result![0]!.confidence).toBe('low');
    });
  });

  describe('inferFunctionPurpose', () => {
    it('returns null when sampling is unavailable', async () => {
      const bridge = createMockBridge(false);
      const deob = new LLMDeobfuscator(bridge);
      const result = await deob.inferFunctionPurpose('function f() { return 1; }');
      expect(result).toBeNull();
    });

    it('returns trimmed LLM response', async () => {
      const bridge = createMockBridge(true, '  This function returns a constant value.  ');
      const deob = new LLMDeobfuscator(bridge);

      const result = await deob.inferFunctionPurpose('function f() { return 1; }');
      expect(result).toBe('This function returns a constant value.');
    });

    it('returns null when sampleText returns null', async () => {
      const bridge = createMockBridge(true, null);
      const deob = new LLMDeobfuscator(bridge);

      const result = await deob.inferFunctionPurpose('function f() {}');
      expect(result).toBeNull();
    });
  });
});
