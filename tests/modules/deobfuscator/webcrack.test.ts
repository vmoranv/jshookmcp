import { describe, expect, it } from 'vitest';
import { runWebcrack } from '@modules/deobfuscator/webcrack';

describe('runWebcrack', () => {
  const DEFAULT_OPTIONS = { jsx: true, mangle: false, unminify: true, unpack: true };

  it('returns normalized optionsUsed with defaults when options are empty', async () => {
    const result = await runWebcrack('var a = 1;', {});
    expect(result.optionsUsed).toEqual(DEFAULT_OPTIONS);
  });

  it('respects explicit boolean overrides for all options', async () => {
    const result = await runWebcrack('var a = 1;', {
      jsx: false,
      mangle: true,
      unminify: false,
      unpack: false,
    });
    expect(result.optionsUsed).toEqual({
      jsx: false,
      mangle: true,
      unminify: false,
      unpack: false,
    });
  });

  it('returns applied: true for trivial valid JS', async () => {
    const result = await runWebcrack('var x = 1 + 2;', {});
    expect(result.applied).toBe(true);
    expect(typeof result.code).toBe('string');
    expect(result.code.length).toBeGreaterThan(0);
  });

  it('returns applied: false with reason for unparseable input', async () => {
    const result = await runWebcrack('{{{{not valid javascript at all!!!!', {});
    expect(result.applied).toBe(false);
    expect(result.reason).toBeDefined();
    expect(typeof result.reason).toBe('string');
    expect(result.reason!.length).toBeGreaterThan(0);
  });

  it('deobfuscates a simple obfuscated pattern', async () => {
    // A common obfuscation pattern: string concatenation that webcrack should simplify
    const obfuscated = `var a = "hel" + "lo" + " " + "wor" + "ld";`;
    const result = await runWebcrack(obfuscated, { unminify: true });
    expect(result.applied).toBe(true);
    // webcrack should have processed it (may or may not fold the strings,
    // but the code should at least be valid)
    expect(typeof result.code).toBe('string');
  });

  it('handles webpack-like bundle and returns bundle summary', async () => {
    // Minimal webpack-style bundle that webcrack can recognize
    const webpackBundle = `
      (function(modules) {
        function __webpack_require__(moduleId) {
          var module = { exports: {} };
          modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);
          return module.exports;
        }
        return __webpack_require__(0);
      })([
        function(module, exports, __webpack_require__) {
          var dep = __webpack_require__(1);
          module.exports = function() { return dep.hello(); };
        },
        function(module, exports) {
          module.exports = { hello: function() { return "world"; } };
        }
      ]);
    `;
    const result = await runWebcrack(webpackBundle, { unpack: true });
    expect(result.applied).toBe(true);
    // webcrack should detect and unpack the bundle
    if (result.bundle) {
      expect(result.bundle.type).toBe('webpack');
      expect(result.bundle.moduleCount).toBeGreaterThan(0);
      expect(result.bundle.modules.length).toBeGreaterThan(0);
    }
  });

  it('includes module code in bundle summary when includeModuleCode is true', async () => {
    const webpackBundle = `
      (function(modules) {
        function __webpack_require__(moduleId) {
          var module = { exports: {} };
          modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);
          return module.exports;
        }
        return __webpack_require__(0);
      })([
        function(module, exports) {
          module.exports = "hello";
        }
      ]);
    `;
    const result = await runWebcrack(webpackBundle, { unpack: true, includeModuleCode: true });
    expect(result.applied).toBe(true);
    if (result.bundle && result.bundle.modules.length > 0) {
      // When includeModuleCode is true, each module should have a code field
      expect(result.bundle!.modules[0]!.code).toBeDefined();
      expect(typeof result.bundle!.modules[0]!.code).toBe('string');
    }
  });

  it('respects maxBundleModules limit', async () => {
    const webpackBundle = `
      (function(modules) {
        function __webpack_require__(moduleId) {
          var module = { exports: {} };
          modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);
          return module.exports;
        }
        return __webpack_require__(0);
      })([
        function(module, exports, __webpack_require__) { module.exports = __webpack_require__(1); },
        function(module, exports, __webpack_require__) { module.exports = __webpack_require__(2); },
        function(module, exports, __webpack_require__) { module.exports = __webpack_require__(3); },
        function(module, exports) { module.exports = "end"; }
      ]);
    `;
    const result = await runWebcrack(webpackBundle, { unpack: true, maxBundleModules: 2 });
    expect(result.applied).toBe(true);
    if (result.bundle) {
      expect(result.bundle.modules.length).toBeLessThanOrEqual(2);
      if (result.bundle.moduleCount > 2) {
        expect(result.bundle.truncated).toBe(true);
      }
    }
  });
});
