import { describe, it, expect } from 'vitest';
import {
  generateEmulationCode,
  generateNodeJSCode,
  generatePythonCode,
  categorizeManifest,
  formatValue,
  formatValueForJS,
  generateRecommendations,
} from '@modules/emulator/EmulatorCodeGen';

describe('EmulatorCodeGen', () => {
  it('generates both runtime code blocks when targetRuntime=both', () => {
    const output = generateEmulationCode({ 'window.innerWidth': 1920 }, 'both', false);

    expect(output.nodejs).toContain('module.exports');
    expect(output.python).toContain('import execjs');
  });

  it('categorizes manifest paths into expected groups', () => {
    const categorized = categorizeManifest({
      'window.a': 1,
      'navigator.b': 2,
      'document.c': 3,
      'foo.bar': 4,
    });

    expect(categorized.window).toHaveLength(1);
    expect(categorized.navigator).toHaveLength(1);
    expect(categorized.document).toHaveLength(1);
    expect(categorized.other).toHaveLength(1);
  });

  it('formats primitive and nested values', () => {
    expect(formatValue('a"b')).toContain('\\"');
    expect(formatValue(123)).toBe('123');
    expect(formatValue([1, 'x'])).toContain('[1, "x"]');
    expect(formatValue({ key: true })).toContain('key: true');
  });

  it('sanitizes special placeholders in formatValueForJS', () => {
    expect(formatValueForJS('[Function]')).toBe('function() {}');
    expect(formatValueForJS('[Circular Reference]')).toBe('{}');
    expect(formatValueForJS('[Max Depth]')).toBe('null');
    expect(formatValueForJS({ a: 1, __internal: 'x' })).toContain('a: 1');
  });

  it('includes optional comments in generated Node/Python templates', () => {
    const nodeCode = generateNodeJSCode({ 'window.a': 1 }, true);
    const pyCode = generatePythonCode({ 'navigator.userAgent': 'ua' }, true);

    expect(nodeCode).toContain('// === Base Variable Declarations ===');
    expect(pyCode).toContain('"""');
  });

  it('creates recommendations from variable/API counts', () => {
    const recommendations = generateRecommendations(
      {
        window: Array.from({ length: 60 }, (_, i) => `window.v${i}`),
        document: [],
        navigator: [],
        location: [],
        screen: [],
        other: [],
      },
      [{ name: 'x', path: 'window.x', type: 'property', suggestion: 'y' }],
    );

    expect(recommendations).toContain('Enable environment emulation for better compatibility');
    expect(recommendations.some((r) => r.includes('1 API'))).toBe(true);
  });

  // --- Additional coverage tests for uncovered lines 35-439, 448, 462 ---

  it('generateEmulationCode with nodejs-only target', () => {
    const output = generateEmulationCode({ 'navigator.userAgent': 'test' }, 'nodejs', false);
    expect(output.nodejs).toContain('module.exports');
    expect(output.python).toBe('');
  });

  it('generateEmulationCode with python-only target', () => {
    const output = generateEmulationCode({ 'navigator.userAgent': 'test' }, 'python', false);
    expect(output.python).toContain('import execjs');
    expect(output.nodejs).toBe('');
  });

  it('generateNodeJSCode without comments omits conditional comment sections', () => {
    const code = generateNodeJSCode({ 'window.a': 1 }, false);
    // Lines 42-48 are UNCONDITIONAL (always emitted), they are not in includeComments blocks
    // Lines 50-62, 63-78, 80-83, 90-94, 96-99, 107-138 are inside if(includeComments) blocks
    expect(code).not.toContain('// === Window Property Aliases ===');
    expect(code).not.toContain('// === Timer & Animation Functions ===');
    expect(code).not.toContain('// === Manifest Variables ===');
    expect(code).toContain('const window = global;');
    expect(code).toContain('module.exports');
  });

  it('generatePythonCode without comments omits conditional comment sections', () => {
    const code = generatePythonCode({ 'navigator.userAgent': 'ua' }, false);
    // The `"""` for env_code (line 179) and `"""` closing (line 263) are always present
    // The `# ==========` sections are inside if(includeComments) blocks
    expect(code).not.toContain('# ========== Environment Variables ==========');
    expect(code).not.toContain('# ========== Browser JavaScript APIs ==========');
    expect(code).not.toContain('# ========== JavaScript Utilities ==========');
    expect(code).not.toContain('# ========== Special Variables ==========');
    expect(code).not.toContain('# ========== Network Requests ==========');
    expect(code).toContain('import execjs');
  });

  it('generatePythonCode with comments includes all comment sections', () => {
    const code = generatePythonCode({ 'navigator.userAgent': 'ua' }, true);
    expect(code).toContain('"""');
    expect(code).toContain('# ==========');
    expect(code).toContain('ctx = execjs.compile(full_code)');
    expect(code).toContain('get_a_bogus(test_url, test_ua)');
  });

  it('categorizeManifest groups location and screen paths', () => {
    const result = categorizeManifest({
      'location.href': 'https://example.com',
      'screen.width': 1920,
    });
    expect(result.location).toHaveLength(1);
    expect(result.screen).toHaveLength(1);
    // @ts-expect-error
    expect(result.location[0][0]).toBe('location.href');
    // @ts-expect-error
    expect(result.screen[0][0]).toBe('screen.width');
  });

  it('categorizeManifest handles all category branches', () => {
    const result = categorizeManifest({
      'window.x': 1,
      'document.y': 2,
      'navigator.z': 3,
      'location.href': 'url',
      'screen.w': 100,
      'other.key': 'val',
    });
    expect(result.window).toHaveLength(1);
    expect(result.document).toHaveLength(1);
    expect(result.navigator).toHaveLength(1);
    expect(result.location).toHaveLength(1);
    expect(result.screen).toHaveLength(1);
    expect(result.other).toHaveLength(1);
  });

  it('formatValue handles null and undefined', () => {
    expect(formatValue(null)).toBe('null');
    expect(formatValue(undefined)).toBe('undefined');
  });

  it('formatValue handles array with more than 10 items', () => {
    const result = formatValue(Array.from({ length: 20 }, (_, i) => i));
    // formatValue slices to 10 items internally
    expect(result).toContain('0');
    expect(result).toContain('9');
    expect(result).not.toContain('10');
  });

  it('formatValueForJS handles large array (>50 items)', () => {
    const largeArray = Array.from({ length: 60 }, (_, i) => ({ v: i }));
    const result = formatValueForJS(largeArray);
    expect(result).toContain('{v: 0}');
    expect(result).toContain('{v: 49}');
    expect(result).not.toContain('{v: 50}');
  });

  it('formatValueForJS handles array with undefined items that get filtered', () => {
    const result = formatValueForJS([1, undefined, 3]);
    expect(result).toContain('1');
    expect(result).toContain('3');
    expect(result).not.toContain('undefined');
  });

  it('formatValueForJS handles empty object (line 448)', () => {
    // Object with only __-prefixed keys -> entries filtered out -> length === 0
    expect(formatValueForJS({ __internal: 'x', __secret: 'y' })).toBe('{}');
    // Also directly empty object
    expect(formatValueForJS({})).toBe('{}');
  });

  it('formatValueForJS handles object with regular keys including special formatting', () => {
    const result = formatValueForJS({ 'my-prop': 1, _private: 2, $special: 3 });
    expect(result).toContain('my-prop');
    expect(result).toContain('_private');
    expect(result).toContain('$special');
    // Keys with special chars should be quoted
    expect(result).toContain('"my-prop"');
  });

  it('formatValueForJS handles __type present but not "Function" (isFunctionMarker false branch)', () => {
    // isFunctionMarker returns false when __type !== 'Function', so object branch is taken.
    // The __type key is then filtered out by the startsWith('__') filter.
    const result = formatValueForJS({ __type: 'Other', visible: 1 });
    expect(result).toContain('visible: 1');
    expect(result).not.toContain('__type');
  });

  it('formatValueForJS handles null primitive value', () => {
    expect(formatValueForJS(null)).toBe('null');
  });

  it('formatValueForJS handles Symbol and BigInt via final fallback (line 462)', () => {
    // Symbol - typeof 'symbol' not handled -> falls to return 'null'
    expect(formatValueForJS(Symbol('test'))).toBe('null');
    // BigInt
    expect(formatValueForJS(BigInt(123))).toBe('null');
  });

  it('formatValueForJS handles NaN and Infinity numbers', () => {
    expect(formatValueForJS(NaN)).toBe('NaN');
    expect(formatValueForJS(Infinity)).toBe('null');
    expect(formatValueForJS(-Infinity)).toBe('null');
  });

  it('formatValueForJS handles [Function:] string pattern', () => {
    expect(formatValueForJS('[Function: myFunc]')).toBe('function() {}');
  });

  it('formatValueForJS handles [Error] and [Error: msg] strings', () => {
    expect(formatValueForJS('[Error]')).toBe('null');
    expect(formatValueForJS('[Error: something went wrong]')).toBe('null');
  });

  it('formatValueForJS handles [Getter Error] string', () => {
    expect(formatValueForJS('[Getter Error]')).toBe('undefined');
  });

  it('formatValueForJS handles undefined primitive value', () => {
    expect(formatValueForJS(undefined)).toBe('undefined');
  });

  it('formatValueForJS handles depth limit (depth > 5)', () => {
    // depth > 5 triggers the early return — depth must be 6 or higher
    expect(formatValueForJS({ a: 1 }, 6)).toBe('null');
    // At depth=5 the object is still formatted normally
    expect(formatValueForJS({ a: 1 }, 5)).not.toBe('null');
  });

  it('generateRecommendations with zero APIs and zero vars returns empty', () => {
    const result = generateRecommendations(
      { window: [], document: [], navigator: [], location: [], screen: [], other: [] },
      [],
    );
    expect(result).toHaveLength(0);
  });

  it('generateRecommendations with many vars but no missing APIs', () => {
    const result = generateRecommendations(
      {
        window: Array.from({ length: 51 }, (_, i) => `window.v${i}`),
        document: [],
        navigator: [],
        location: [],
        screen: [],
        other: [],
      },
      [],
    );
    expect(result).toContain('Enable environment emulation for better compatibility');
    expect(result).toHaveLength(1);
  });

  it('generateRecommendations with more than 50 missing APIs', () => {
    const missing = Array.from({ length: 55 }, (_, i) => ({
      name: `api${i}`,
      path: `window.api${i}`,
      type: 'function' as const,
      suggestion: 'stub',
    }));
    const result = generateRecommendations(
      { window: [], document: [], navigator: [], location: [], screen: [], other: [] },
      missing,
    );
    expect(result.some((r) => r.includes('55 API'))).toBe(true);
  });

  it('generateNodeJSCode handles deep property paths (parts.length > 2)', () => {
    const code = generateNodeJSCode({ 'window.foo.bar.baz': 42 }, false);
    expect(code).toContain('if (!window.foo.bar) window.foo.bar = {};');
    expect(code).toContain('window.foo.bar.baz = 42');
  });

  it('generatePythonCode handles deep property paths', () => {
    // navigator.plugins.0.name splits into ['navigator','plugins','0','name'] (4 parts)
    // parentPath = parts.slice(0,-1).join('.') = 'navigator.plugins.0'
    const code = generatePythonCode({ 'navigator.plugins.0.name': 'plugin' }, false);
    expect(code).toContain('navigator.plugins.0.name = "plugin"');
  });

  it('formatValue handles actual function type (line 383)', () => {
    // type === 'function' triggers the early return
    const result = formatValue(function myFunc() {});
    expect(result).toBe('function() {}');
  });

  it('formatValueForJS handles boolean values (line 427)', () => {
    expect(formatValueForJS(true)).toBe('true');
    expect(formatValueForJS(false)).toBe('false');
  });

  it('formatValueForJS handles { __type: "Function" } function marker (line 431)', () => {
    expect(formatValueForJS({ __type: 'Function' })).toBe('function() {}');
  });

  it('formatValue handles Symbol via fallback (line 397)', () => {
    // Symbol: typeof is 'symbol', not handled by any branch, falls through to return 'null'
    expect(formatValue(Symbol('test'))).toBe('null');
  });
});
