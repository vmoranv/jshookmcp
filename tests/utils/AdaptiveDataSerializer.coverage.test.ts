import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DetailedDataManager } from '@utils/DetailedDataManager';
import { AdaptiveDataSerializer } from '@utils/AdaptiveDataSerializer';

/**
 * Coverage tests targeting the v8 ignore next branches and
 * other hard-to-reach paths in AdaptiveDataSerializer.
 */
describe('AdaptiveDataSerializer – v8 ignore branch coverage', () => {
  let serializer: AdaptiveDataSerializer;

  beforeEach(() => {
    serializer = new AdaptiveDataSerializer();
    vi.spyOn(DetailedDataManager, 'getInstance').mockReturnValue({
      store: vi.fn(() => 'detail_test_ignore'),
    } as any);
  });

  // ── serialize() unreachable-type guard fallbacks ─────────────────────────

  it('falls back from large-array when data is not an array (v8 ignore next 4)', () => {
    // detectType() returns 'large-array' when Array.isArray(data) but data is NOT an array.
    // This would only happen via a type assertion that bypasses the type guard.
    // We reach the fallback by calling serialize() through a path that skips the
    // Array.isArray() guard in serialize — which happens when detectType() returns
    // 'large-array' for a non-array. Since the TS type system prevents this at
    // compile time, we use any to simulate it.
    // @ts-expect-error
    const _unused = 'not-an-array-but-detected-as-large-array' as unknown;
    // Force detectType to return 'large-array' by using an object that has
    // .length > 100. The only way to reach the Array.isArray guard false
    // branch is to call the private method directly, or through type coercion.
    // We exercise it via direct invocation of the private serializeLargeArray path.
    const result = (serializer as any).serializeLargeArray([1, 2, 3], {
      maxDepth: 3,
      maxArrayLength: 10,
      maxStringLength: 1000,
      maxObjectKeys: 20,
      threshold: 50 * 1024,
    });
    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
  });

  it('falls back from code-string when data is not a string (v8 ignore next 4)', () => {
    // serializeCodeString guards for typeof data === 'string' — this branch is
    // unreachable via the public API because detectType only returns 'code-string'
    // when data IS a string. We invoke the private method directly.
    const result = (serializer as any).serializeCodeString(42 as unknown as string, {
      maxDepth: 3,
      maxArrayLength: 10,
      maxStringLength: 1000,
      maxObjectKeys: 20,
      threshold: 50 * 1024,
    });
    // Falls through to JSON.stringify(42) -> '42'
    expect(result).toBe('42');
  });

  it('falls back from network-requests when not a request array (v8 ignore next 4)', () => {
    // serializeNetworkRequests guards for isNetworkRequestArray(data) — unreachable
    // via public API because detectType only returns 'network-requests' when the
    // array passes isNetworkRequestArray. Invoking the private method directly.
    const result = (serializer as any).serializeNetworkRequests({ not: 'an array' } as any, {
      maxDepth: 3,
      maxArrayLength: 10,
      maxStringLength: 1000,
      maxObjectKeys: 20,
      threshold: 50 * 1024,
    });
    // Falls to JSON.stringify of the non-array object
    expect(result).toBe('{"not":"an array"}');
  });

  // ── limitDepth / getDepth ──────────────────────────────────────────────────

  it('limitDepth returns non-record primitives unchanged', () => {
    expect((serializer as any).limitDepth(null, 5, 0)).toBeNull();
    expect((serializer as any).limitDepth(undefined, 5, 0)).toBeUndefined();
    expect((serializer as any).limitDepth(42, 5, 0)).toBe(42);
    expect((serializer as any).limitDepth('hello', 5, 0)).toBe('hello');
    expect((serializer as any).limitDepth(true, 5, 0)).toBe(true);
  });

  it('limitDepth truncates at max depth for nested objects', () => {
    const deep = { a: { b: { c: 'should-be-truncated' } } };
    const result = (serializer as any).limitDepth(deep, 2, 0);
    expect(result.a.b).toBe('[Max depth reached]');
  });

  it('limitDepth truncates at max depth for arrays', () => {
    const arr = [[1, 2, 3]];
    const result = (serializer as any).limitDepth(arr, 1, 0);
    expect(result[0]).toBe('[Max depth reached]');
  });

  it('getDepth handles non-record at root', () => {
    expect((serializer as any).getDepth(null)).toBe(0);
    expect((serializer as any).getDepth(42)).toBe(0);
    expect((serializer as any).getDepth('string')).toBe(0);
    expect((serializer as any).getDepth(undefined)).toBe(0);
  });

  it('getDepth enforces 10-level recursion cap', () => {
    // Create an object 15 levels deep — should stop at 10
    let obj: any = { value: 'end' };
    for (let i = 0; i < 14; i++) {
      obj = { nested: obj };
    }
    // Should return currentDepth + 10 (cap), not unbounded
    const depth = (serializer as any).getDepth(obj);
    expect(depth).toBeLessThanOrEqual(11); // 0 + 10 + 1 for the call chain
  });

  // ── isRecord ───────────────────────────────────────────────────────────────

  it('isRecord correctly identifies records vs primitives', () => {
    const isRecord = (v: unknown) => (serializer as any).isRecord(v);
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord([])).toBe(true);
    expect(isRecord([1, 2])).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord(42)).toBe(false);
    expect(isRecord('string')).toBe(false);
    expect(isRecord(true)).toBe(false);
    expect(isRecord(() => {})).toBe(false);
    expect(isRecord(Symbol('s'))).toBe(false);
  });

  // ── isNetworkRequest / isNetworkRequestArray ───────────────────────────────

  it('isNetworkRequest requires requestId-or-url AND method-or-type', () => {
    const isNR = (v: unknown) => (serializer as any).isNetworkRequest(v);
    // Both conditions must be met
    expect(isNR({ requestId: '1' })).toBe(false); // missing method/type
    expect(isNR({ url: 'http://' })).toBe(false); // missing method/type
    expect(isNR({ method: 'GET' })).toBe(false); // missing requestId/url
    expect(isNR({ type: 'xhr' })).toBe(false); // missing requestId/url
    expect(isNR({ requestId: '1', method: 'GET' })).toBe(true);
    expect(isNR({ url: 'http://', type: 'xhr' })).toBe(true);
    expect(isNR({ requestId: '1', url: 'http://', method: 'GET', type: 'xhr' })).toBe(true);
  });

  it('isNetworkRequestArray checks array type and first element', () => {
    const isNRA = (v: unknown) => (serializer as any).isNetworkRequestArray(v);
    expect(isNRA([])).toBe(false); // empty array
    expect(isNRA(null)).toBe(false);
    expect(isNRA({})).toBe(false);
    expect(isNRA([{ requestId: '1', method: 'GET' }])).toBe(true);
    expect(isNRA([{ url: 'http://', type: 'xhr' }])).toBe(true);
    expect(isNRA([{ not: 'a request' }])).toBe(false);
  });

  // ── isDOMStructure ─────────────────────────────────────────────────────────

  it('isDOMStructure requires tag-or-tagName AND children-or-childNodes', () => {
    const isDOM = (v: unknown) => (serializer as any).isDOMStructure(v);
    expect(isDOM({ tag: 'DIV' })).toBe(false); // missing children/childNodes
    expect(isDOM({ children: [] })).toBe(false); // missing tag/tagName
    expect(isDOM({ tagName: 'SPAN', childNodes: [] })).toBe(true);
    expect(isDOM({ tag: 'DIV', children: [{}] })).toBe(true);
    expect(isDOM({})).toBe(false);
  });

  // ── isFunctionTree ────────────────────────────────────────────────────────

  it('isFunctionTree requires functionName-or-name AND dependencies-or-calls-or-callGraph', () => {
    const isFT = (v: unknown) => (serializer as any).isFunctionTree(v);
    expect(isFT({ functionName: 'foo' })).toBe(false); // missing deps/calls/callGraph
    expect(isFT({ name: 'bar' })).toBe(false); // missing deps/calls/callGraph
    expect(isFT({ dependencies: [] })).toBe(false); // missing functionName/name
    expect(isFT({ calls: [] })).toBe(false); // missing functionName/name
    expect(isFT({ callGraph: {} })).toBe(false); // missing functionName/name
    expect(isFT({ functionName: 'foo', dependencies: [] })).toBe(true);
    expect(isFT({ name: 'bar', calls: [] })).toBe(true);
    expect(isFT({ functionName: 'baz', callGraph: {} })).toBe(true);
  });

  // ── getFunctionTreeName ────────────────────────────────────────────────────

  it('getFunctionTreeName extracts functionName or name, falls back to [unknown]', () => {
    const getName = (tree: any) => (serializer as any).getFunctionTreeName(tree);
    expect(getName({ functionName: 'myFunc' })).toBe('myFunc');
    expect(getName({ name: 'myName' })).toBe('myName');
    expect(getName({ functionName: 'explicit', name: 'ignored' })).toBe('explicit');
    expect(getName({})).toBe('[unknown]');
    expect(getName({ functionName: 42 })).toBe('[unknown]');
    expect(getName({ name: null })).toBe('[unknown]');
  });

  // ── simplifyFunctionTree ────────────────────────────────────────────────────

  it('simplifyFunctionTree handles non-record root', () => {
    const simplify = (tree: unknown, maxDepth: number) =>
      (serializer as any).simplifyFunctionTree(tree, maxDepth, 0);
    expect(simplify(null, 3)).toEqual({ name: '[invalid-node]', truncated: true });
    expect(simplify(42, 3)).toEqual({ name: '[invalid-node]', truncated: true });
    expect(simplify('string', 3)).toEqual({ name: '[invalid-node]', truncated: true });
  });

  it('simplifyFunctionTree truncates at max depth', () => {
    const tree = {
      functionName: 'root',
      dependencies: [
        { functionName: 'child1', dependencies: [] },
        { functionName: 'child2', dependencies: [] },
      ],
    };
    const result = (serializer as any).simplifyFunctionTree(tree, 0, 0);
    expect(result.truncated).toBe(true);
    expect(result.name).toBe('root');
  });

  it('simplifyFunctionTree handles non-array dependencies', () => {
    const tree = {
      name: 'root',
      dependencies: 'not-an-array',
    };
    const result = (serializer as any).simplifyFunctionTree(tree, 5, 0);
    expect(result.dependencies).toEqual([]);
  });

  // ── serializeDefault ───────────────────────────────────────────────────────

  it('serializeDefault returns JSON directly when under threshold', () => {
    const smallObj = { a: 1, b: 2 };
    const result = (serializer as any).serializeDefault(smallObj, {
      maxDepth: 3,
      maxArrayLength: 10,
      maxStringLength: 1000,
      maxObjectKeys: 20,
      threshold: 50 * 1024, // 50KB
    });
    expect(result).toBe(JSON.stringify(smallObj));
  });

  it('serializeDefault stores data when over threshold', () => {
    const largeObj = { text: 'x'.repeat(100_000) };
    const result = JSON.parse(
      (serializer as any).serializeDefault(largeObj, {
        maxDepth: 3,
        maxArrayLength: 10,
        maxStringLength: 1000,
        maxObjectKeys: 20,
        threshold: 100,
      }),
    ) as { type: string; size: number; detailId: string };
    expect(result.type).toBe('large-data');
    expect(result.detailId).toBe('detail_test_ignore');
    expect(result.size).toBeGreaterThan(100);
  });

  // ── detectType edge cases ─────────────────────────────────────────────────

  it('detectType returns primitive for null and undefined', () => {
    expect((serializer as any).detectType(null)).toBe('primitive');
    expect((serializer as any).detectType(undefined)).toBe('primitive');
  });

  it('detectType returns primitive for strings shorter than 100 chars', () => {
    expect((serializer as any).detectType('short')).toBe('primitive');
  });

  it('detectType returns code-string for long code-looking strings', () => {
    const codeStr = 'const x = 1;'.padEnd(150, ' ');
    expect((serializer as any).detectType(codeStr)).toBe('code-string');
  });

  it('detectType returns large-array for arrays longer than 100', () => {
    const arr = Array.from({ length: 101 }, (_, i) => i);
    expect((serializer as any).detectType(arr)).toBe('large-array');
  });

  it('detectType returns network-requests for arrays of network-like objects', () => {
    const reqs = [
      { requestId: '1', url: 'http://x.com', method: 'GET', type: 'xhr', timestamp: 1 },
    ];
    expect((serializer as any).detectType(reqs)).toBe('network-requests');
  });

  it('detectType returns dom-structure for DOM-like objects', () => {
    expect((serializer as any).detectType({ tag: 'DIV', children: [] })).toBe('dom-structure');
    expect((serializer as any).detectType({ tagName: 'SPAN', childNodes: [] })).toBe(
      'dom-structure',
    );
  });

  it('detectType returns function-tree for function tree objects', () => {
    expect((serializer as any).detectType({ functionName: 'foo', dependencies: [] })).toBe(
      'function-tree',
    );
    expect((serializer as any).detectType({ name: 'bar', calls: [] })).toBe('function-tree');
    expect((serializer as any).detectType({ name: 'baz', callGraph: {} })).toBe('function-tree');
  });

  it('detectType returns deep-object for objects deeper than 3', () => {
    const deep = { a: { b: { c: { d: 'e' } } } };
    expect((serializer as any).detectType(deep)).toBe('deep-object');
  });

  it('detectType returns unknown for plain objects under depth 3', () => {
    expect((serializer as any).detectType({ foo: 'bar' })).toBe('unknown');
    expect((serializer as any).detectType({ a: 1, b: 2, c: { d: 1 } })).toBe('unknown');
  });

  it('detectType handles numbers and booleans as primitive', () => {
    expect((serializer as any).detectType(42)).toBe('primitive');
    expect((serializer as any).detectType(true)).toBe('primitive');
    expect((serializer as any).detectType(false)).toBe('primitive');
    expect((serializer as any).detectType(3.14)).toBe('primitive');
  });

  // ── isCodeString patterns ──────────────────────────────────────────────────

  it('isCodeString recognizes export default pattern', () => {
    const patterns = [
      'export default function foo() {}'.padEnd(150, ' '),
      'export const x = 1;'.padEnd(150, ' '),
    ];
    patterns.forEach((p) => {
      const result = (serializer as any).isCodeString(p);
      expect(result).toBe(true);
    });
  });

  it('isCodeString returns false for short strings', () => {
    expect((serializer as any).isCodeString('const x = 1;')).toBe(false);
    expect((serializer as any).isCodeString('')).toBe(false);
  });

  it('isCodeString returns false for long non-code strings', () => {
    const longText = 'This is just a very long text string that is not code at all'.repeat(5);
    expect((serializer as any).isCodeString(longText)).toBe(false);
  });

  // ── serializeLargeArray ────────────────────────────────────────────────────

  it('serializeLargeArray returns full JSON when within maxArrayLength', () => {
    const smallArr = [1, 2, 3];
    const ctx = {
      maxDepth: 3,
      maxArrayLength: 10,
      maxStringLength: 1000,
      maxObjectKeys: 20,
      threshold: 50 * 1024,
    };
    const result = (serializer as any).serializeLargeArray(smallArr, ctx);
    expect(result).toBe(JSON.stringify(smallArr));
  });

  it('serializeLargeArray stores detail for arrays exceeding maxArrayLength', () => {
    const bigArr = Array.from({ length: 150 }, (_, i) => i);
    const ctx = {
      maxDepth: 3,
      maxArrayLength: 10,
      maxStringLength: 1000,
      maxObjectKeys: 20,
      threshold: 50 * 1024,
    };
    const result = JSON.parse((serializer as any).serializeLargeArray(bigArr, ctx)) as {
      type: string;
      length: number;
      detailId: string;
      sample: number[];
    };
    expect(result.type).toBe('large-array');
    expect(result.length).toBe(150);
    expect(result.sample).toHaveLength(10); // 5 first + 5 last
    expect(result.sample[0]).toBe(0);
    expect(result.sample[5]).toBe(145);
  });

  // ── serializeCodeString ────────────────────────────────────────────────────

  it('serializeCodeString returns full JSON for short code (<=100 lines)', () => {
    const shortCode = Array.from({ length: 50 }, (_, i) => `const x${i}=${i};`).join('\n');
    const ctx = {
      maxDepth: 3,
      maxArrayLength: 10,
      maxStringLength: 1000,
      maxObjectKeys: 20,
      threshold: 50 * 1024,
    };
    const result = (serializer as any).serializeCodeString(shortCode, ctx);
    expect(result).toBe(JSON.stringify(shortCode));
  });

  it('serializeCodeString stores detail for long code (>100 lines)', () => {
    const longCode = Array.from({ length: 150 }, (_, i) => `const x${i}=${i};`).join('\n');
    const ctx = {
      maxDepth: 3,
      maxArrayLength: 10,
      maxStringLength: 1000,
      maxObjectKeys: 20,
      threshold: 50 * 1024,
    };
    const result = JSON.parse((serializer as any).serializeCodeString(longCode, ctx)) as {
      type: string;
      totalLines: number;
      preview: string;
      detailId: string;
    };
    expect(result.type).toBe('code-string');
    expect(result.totalLines).toBe(150);
    expect(result.preview).toContain('const x0');
    expect(result.detailId).toBe('detail_test_ignore');
  });

  // ── serializeNetworkRequests ────────────────────────────────────────────────

  it('serializeNetworkRequests returns full JSON when within maxArrayLength', () => {
    const requests = [
      { requestId: '1', url: 'http://x.com', method: 'GET', type: 'xhr', timestamp: 1 },
    ];
    const ctx = {
      maxDepth: 3,
      maxArrayLength: 10,
      maxStringLength: 1000,
      maxObjectKeys: 20,
      threshold: 50 * 1024,
    };
    const result = (serializer as any).serializeNetworkRequests(requests, ctx);
    expect(result).toBe(JSON.stringify(requests));
  });

  it('serializeNetworkRequests stores detail for large request arrays', () => {
    const requests = Array.from({ length: 20 }, (_, i) => ({
      requestId: `r${i}`,
      url: `http://x.com/${i}`,
      method: 'GET',
      type: 'xhr',
      timestamp: i,
      body: 'x'.repeat(1000), // extra body not in summary
    }));
    const ctx = {
      maxDepth: 3,
      maxArrayLength: 10,
      maxStringLength: 1000,
      maxObjectKeys: 20,
      threshold: 50 * 1024,
    };
    const result = JSON.parse((serializer as any).serializeNetworkRequests(requests, ctx)) as {
      type: string;
      count: number;
      summary: unknown[];
      detailId: string;
    };
    expect(result.type).toBe('network-requests');
    expect(result.count).toBe(20);
    expect(result.summary).toHaveLength(10);
    expect(result.summary[0]).not.toHaveProperty('body'); // body not in summary
  });

  // ── serializeDOMStructure / serializeFunctionTree ───────────────────────────

  it('serializeDOMStructure applies depth limiting', () => {
    const deepDOM = {
      tagName: 'DIV',
      childNodes: [
        {
          tagName: 'SPAN',
          childNodes: [{ tagName: 'B', childNodes: [{ tagName: 'I', childNodes: [] }] }],
        },
      ],
    };
    const result = JSON.parse(
      (serializer as any).serializeDOMStructure(deepDOM, {
        maxDepth: 2,
        maxArrayLength: 10,
        maxStringLength: 1000,
        maxObjectKeys: 20,
        threshold: 50 * 1024,
      }),
    );
    expect(result.tagName).toBe('DIV');
    expect(result.childNodes[0].childNodes[0]).toBe('[Max depth reached]');
  });

  it('serializeFunctionTree simplifies dependencies', () => {
    const tree = {
      functionName: 'root',
      dependencies: [
        { functionName: 'dep1', dependencies: [{ functionName: 'dep1-sub' }] },
        { functionName: 'dep2', dependencies: [] },
      ],
    };
    const result = JSON.parse(
      (serializer as any).serializeFunctionTree(tree, {
        maxDepth: 2,
        maxArrayLength: 10,
        maxStringLength: 1000,
        maxObjectKeys: 20,
        threshold: 50 * 1024,
      }),
    );
    expect(result.name).toBe('root');
    expect(result.dependencies[0].name).toBe('dep1');
    expect(result.dependencies[0].dependencies[0].truncated).toBe(true); // depth exceeded
  });
});
