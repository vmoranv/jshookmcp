import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DetailedDataManager } from './DetailedDataManager.js';
import { AdaptiveDataSerializer } from './AdaptiveDataSerializer.js';

describe('AdaptiveDataSerializer', () => {
  let serializer: AdaptiveDataSerializer;
  let storeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    serializer = new AdaptiveDataSerializer();
    storeMock = vi.fn(() => 'detail_test_123');
    vi.spyOn(DetailedDataManager, 'getInstance').mockReturnValue({
      store: storeMock,
    } as any);
  });

  it('serializes primitive values directly', () => {
    expect(serializer.serialize(42)).toBe('42');
    expect(serializer.serialize(true)).toBe('true');
  });

  it('serializes large arrays with summary and detailId', () => {
    const data = Array.from({ length: 120 }, (_, i) => i);
    const output = JSON.parse(serializer.serialize(data));

    expect(output.type).toBe('large-array');
    expect(output.length).toBe(120);
    expect(output.detailId).toBe('detail_test_123');
    expect(output.sample).toHaveLength(10);
  });

  it('serializes long code strings with preview', () => {
    const code = `function foo() {\n${Array.from({ length: 120 }, (_, i) => `const x${i} = ${i};`).join('\n')}\n}`;
    const output = JSON.parse(serializer.serialize(code));

    expect(output.type).toBe('code-string');
    expect(output.totalLines).toBeGreaterThan(100);
    expect(output.preview).toContain('function foo');
    expect(output.detailId).toBe('detail_test_123');
  });

  it('summarizes network request arrays when exceeding max length', () => {
    const requests = Array.from({ length: 12 }, (_, i) => ({
      requestId: `r${i}`,
      url: `https://example.com/${i}`,
      method: 'GET',
      type: 'xhr',
      timestamp: i,
      body: 'large-body',
    }));
    const output = JSON.parse(serializer.serialize(requests));

    expect(output.type).toBe('network-requests');
    expect(output.count).toBe(12);
    expect(output.summary).toHaveLength(10);
    expect(output.summary[0]).toEqual({
      requestId: 'r0',
      url: 'https://example.com/0',
      method: 'GET',
      type: 'xhr',
      timestamp: 0,
    });
  });

  it('limits depth for deep objects', () => {
    const deep = { a: { b: { c: { d: { e: 'value' } } } } };
    const output = JSON.parse(serializer.serialize(deep, { maxDepth: 3 }));

    expect(output.a.b.c).toBe('[Max depth reached]');
  });

  it('falls back to large-data summary for oversized unknown objects', () => {
    const payload = { text: 'x'.repeat(5000) };
    const output = JSON.parse(serializer.serialize(payload, { threshold: 100 }));

    expect(output.type).toBe('large-data');
    expect(output.detailId).toBe('detail_test_123');
    expect(output.size).toBeGreaterThan(100);
  });
});

