import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DetailedDataManager } from '@utils/DetailedDataManager';
import { AdaptiveDataSerializer } from '@utils/AdaptiveDataSerializer';

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
    const output = JSON.parse(serializer.serialize(data)) as {
      type: string;
      length: number;
      detailId: string;
      sample: any[];
    };

    expect(output.type).toBe('large-array');
    expect(output.length).toBe(120);
    expect(output.detailId).toBe('detail_test_123');
    expect(output.sample).toHaveLength(10);
  });

  it('serializes long code strings with preview', () => {
    const code = `function foo() {\n${Array.from({ length: 120 }, (_, i) => `const x${i} = ${i};`).join('\n')}\n}`;
    const output = JSON.parse(serializer.serialize(code)) as {
      type: string;
      totalLines: number;
      preview: string;
      detailId: string;
    };

    expect(output.type).toBe('code-string');
    expect(output.totalLines).toBeGreaterThan(100);
    expect(output.preview).toContain('function foo');
    expect(output.detailId).toBe('detail_test_123');
  });

  it('summarizes network request arrays when exceeding max length', () => {
    const requests = Array.from({ length: 12 }, (_, i) => ({
      requestId: `r${i}`,
      url: `https://vmoranv.github.io/jshookmcp/${i}`,
      method: 'GET',
      type: 'xhr',
      timestamp: i,
      body: 'large-body',
    }));
    const output = JSON.parse(serializer.serialize(requests)) as {
      type: string;
      count: number;
      summary: any[];
    };

    expect(output.type).toBe('network-requests');
    expect(output.count).toBe(12);
    expect(output.summary).toHaveLength(10);
    expect(output.summary[0]).toEqual({
      requestId: 'r0',
      url: 'https://vmoranv.github.io/jshookmcp/0',
      method: 'GET',
      type: 'xhr',
      timestamp: 0,
    });
  });

  it('limits depth for deep objects', () => {
    const deep = { a: { b: { c: { d: { e: 'value' } } } } };
    const output = JSON.parse(serializer.serialize(deep, { maxDepth: 3 })) as Record<string, any>;

    expect(output.a.b.c).toBe('[Max depth reached]');
  });

  it('falls back to large-data summary for oversized unknown objects', () => {
    const payload = { text: 'x'.repeat(5000) };
    const output = JSON.parse(serializer.serialize(payload, { threshold: 100 })) as {
      type: string;
      detailId: string;
      size: number;
    };

    expect(output.type).toBe('large-data');
    expect(output.detailId).toBe('detail_test_123');
    expect(output.size).toBeGreaterThan(100);
  });

  it('serializes small structures without summarization', () => {
    expect(serializer.serialize(null)).toBe('null');
    expect(serializer.serialize([])).toBe('[]');
    expect(serializer.serialize('function test() {}')).toBe('"function test() {}"');

    const smallNetwork = [{ requestId: '1', url: 'test', method: 'GET' }];
    expect(serializer.serialize(smallNetwork)).toBe(JSON.stringify(smallNetwork));
  });

  it('serializes custom AST representations (DOM and Function Trees)', () => {
    const dom = { tagName: 'DIV', childNodes: [] };
    expect(serializer.serialize(dom)).toBe(JSON.stringify(dom));

    const tree = {
      functionName: 'main',
      dependencies: [
        { functionName: 'sub', dependencies: [] },
        null, // triggers !isRecord
      ],
    };
    const treeOut = JSON.parse(serializer.serialize(tree));
    expect(treeOut.name).toBe('main');
    expect(treeOut.dependencies[1].name).toBe('[invalid-node]');
    expect(treeOut.dependencies[1].truncated).toBe(true);
  });

  describe('Edge cases and boundary constraints', () => {
    it('should serialize a large array without truncation if maxArrayLength allows it', () => {
      const localSerializer = new AdaptiveDataSerializer();
      const arr = Array.from({ length: 150 }).fill('test');
      const res = localSerializer.serialize(arr, { maxArrayLength: 200 });
      // It should NOT truncate because 150 <= 200, returning the standard stringified array
      expect(res.includes('large-array')).toBe(false);
      expect(res).toBe(JSON.stringify(arr));
    });

    it('should serialize code strings shorter than 100 lines without truncation', () => {
      const localSerializer2 = new AdaptiveDataSerializer();
      // Length > 100 to trigger 'code-string' detection
      const shortCode = 'const a = 1;' + ' '.repeat(150);
      const res = localSerializer2.serialize(shortCode);
      expect(res.includes('preview')).toBe(false);
      expect(res).toBe(JSON.stringify(shortCode));
    });

    it('should simplify function trees with invalid dependency nodes cleanly', () => {
      const localSerializer3 = new AdaptiveDataSerializer();
      const badTree = {
        name: 'root',
        dependencies: [
          'this-is-not-an-object', // Will trigger simplification invalid-node branch
        ],
      };
      const res = localSerializer3.serialize(badTree, { maxDepth: 5 });
      expect(res).toContain('invalid-node');
    });
  });
});
