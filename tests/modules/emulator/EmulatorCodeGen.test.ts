import { describe, it, expect } from 'vitest';
import {
  generateEmulationCode,
  generateNodeJSCode,
  generatePythonCode,
  categorizeManifest,
  formatValue,
  formatValueForJS,
  generateRecommendations,
} from '../../../src/modules/emulator/EmulatorCodeGen.js';

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
      [{ name: 'x', path: 'window.x', type: 'property', suggestion: 'y' }]
    );

    expect(recommendations).toContain('Enable environment emulation for better compatibility');
    expect(recommendations.some((r) => r.includes('1 API'))).toBe(true);
  });
});

