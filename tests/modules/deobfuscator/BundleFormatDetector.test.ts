import { describe, it, expect, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: loggerState,
}));

import { detectBundleFormat } from '@modules/deobfuscator/BundleFormatDetector';

describe('BundleFormatDetector', () => {
  describe('detectBundleFormat', () => {
    it('identifies webpack bundles', () => {
      const code = `var __webpack_require__ = 1; var __webpack_modules__ = {};`;
      const result = detectBundleFormat(code);
      expect(result.format).toBe('webpack');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('identifies rollup bundles', () => {
      const code = `var __rollup__ = 1; var __esModule = true;`;
      const result = detectBundleFormat(code);
      expect(result.format).toBe('rollup');
    });

    it('identifies vite bundles', () => {
      const code = `var __vite = 1; import.meta.url;`;
      const result = detectBundleFormat(code);
      expect(result.format).toBe('vite');
    });

    it('identifies esbuild bundles', () => {
      const code = `var __esmProps = {}; var __esmModule = 1;`;
      const result = detectBundleFormat(code);
      expect(result.format).toBe('esbuild');
    });

    it('identifies systemjs bundles', () => {
      const code = `System.register('test', [], function(exports) { return {}; });`;
      const result = detectBundleFormat(code);
      expect(result.format).toBe('systemjs');
    });

    it('identifies commonjs modules', () => {
      const code = `module.exports = {};`;
      const result = detectBundleFormat(code);
      expect(result.format).toBe('commonjs');
    });

    it('identifies esm modules', () => {
      const code = `import { foo } from './bar.js'; export const x = 1;`;
      const result = detectBundleFormat(code);
      expect(result.format).toBe('esm');
    });

    it('identifies snowpack bundles', () => {
      const code = `var __snowpack__ = {}; __snowpack_plugin__;`;
      const result = detectBundleFormat(code);
      expect(result.format).toBe('snowpack');
    });

    it('identifies fusebox bundles', () => {
      const code = `var __fusebox__ = {}; var __FUSEOBJECT__ = 1;`;
      const result = detectBundleFormat(code);
      expect(result.format).toBe('fusebox');
    });

    it('identifies requirejs bundles', () => {
      const code = `require(["dep1", "dep2"], function(dep1, dep2) {});`;
      const result = detectBundleFormat(code);
      expect(result.format).toBe('requirejs');
    });

    it('returns unknown for plain code', () => {
      const code = `function test() { return 42; }`;
      const result = detectBundleFormat(code);
      expect(result.format).toBe('unknown');
      expect(result.confidence).toBe(0);
    });

    it('returns markers array', () => {
      const code = `__webpack_require__; __webpack_modules__;`;
      const result = detectBundleFormat(code);
      expect(result.markers).toBeInstanceOf(Array);
      expect(result.markers.length).toBeGreaterThan(0);
    });
  });
});
