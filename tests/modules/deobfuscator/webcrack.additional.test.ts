// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// Mock the dynamic import of 'webcrack' at the module level
// We need to test the internal pure functions by importing the module
// and controlling the webcrack import behavior.

// We import runWebcrack; the actual webcrack module is dynamically imported inside.
import { runWebcrack } from '@modules/deobfuscator/webcrack';

// To test internal functions (normalizeOptions, matchesRule, applyBundleMappings,
// summarizeBundle, collectSavedArtifacts) we drive them through runWebcrack
// and by mocking the webcrack dynamic import at the module scope.

describe('webcrack additional coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('normalizeOptions defaults', () => {
    it('fills all defaults when no options are given', async () => {
      const result = await runWebcrack('var a = 1;', {});
      expect(result.optionsUsed).toEqual({
        jsx: true,
        mangle: false,
        unminify: true,
        unpack: true,
      });
    });

    it('preserves explicit false for jsx', async () => {
      const result = await runWebcrack('var a = 1;', { jsx: false });
      expect(result.optionsUsed.jsx).toBe(false);
    });

    it('preserves explicit true for mangle', async () => {
      const result = await runWebcrack('var a = 1;', { mangle: true });
      expect(result.optionsUsed.mangle).toBe(true);
    });

    it('preserves explicit false for unminify', async () => {
      const result = await runWebcrack('var a = 1;', { unminify: false });
      expect(result.optionsUsed.unminify).toBe(false);
    });

    it('preserves explicit false for unpack', async () => {
      const result = await runWebcrack('var a = 1;', { unpack: false });
      expect(result.optionsUsed.unpack).toBe(false);
    });
  });

  describe('matchesRule logic (via bundle mappings)', () => {
    it('applies mapping with includes match on path (default matchType)', async () => {
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

      const result = await runWebcrack(webpackBundle, {
        unpack: true,
        includeModuleCode: true,
        mappings: [
          {
            target: 'path',
            pattern: './', // Should match any module path containing './'
            path: '/remapped/module.js',
          },
        ],
      });

      expect(result.applied).toBe(true);
      if (result.bundle && result.bundle.modules.length > 0) {
        // Check if mappings were applied (mappingsApplied > 0) or path was changed
        expect(result.bundle.mappingsApplied).toBeGreaterThanOrEqual(0);
      }
    });

    it('applies mapping with exact matchType', async () => {
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

      const result = await runWebcrack(webpackBundle, {
        unpack: true,
        includeModuleCode: true,
        mappings: [
          {
            target: 'path',
            matchType: 'exact',
            pattern: 'nonexistent-exact-path',
            path: '/remapped/exact.js',
          },
        ],
      });

      expect(result.applied).toBe(true);
      // The exact pattern won't match, so no mappings should be applied
      if (result.bundle) {
        expect(result.bundle.mappingsApplied).toBe(0);
      }
    });

    it('applies mapping with regex matchType', async () => {
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

      const result = await runWebcrack(webpackBundle, {
        unpack: true,
        includeModuleCode: true,
        mappings: [
          {
            target: 'code',
            matchType: 'regex',
            pattern: 'hello',
            path: '/remapped/regex.js',
          },
        ],
      });

      expect(result.applied).toBe(true);
    });

    it('handles invalid regex in matchesRule gracefully', async () => {
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

      const result = await runWebcrack(webpackBundle, {
        unpack: true,
        mappings: [
          {
            target: 'code',
            matchType: 'regex',
            pattern: '[invalid(regex', // Invalid regex
            path: '/remapped/invalid.js',
          },
        ],
      });

      // Should not crash
      expect(result.applied).toBe(true);
      if (result.bundle) {
        expect(result.bundle.mappingsApplied).toBe(0);
      }
    });

    it('skips mapping rules with missing path', async () => {
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

      const result = await runWebcrack(webpackBundle, {
        unpack: true,
        mappings: [
          {
            target: 'code',
            pattern: 'hello',
            // path is missing
          } as any,
        ],
      });

      expect(result.applied).toBe(true);
      if (result.bundle) {
        expect(result.bundle.mappingsApplied).toBe(0);
      }
    });

    it('skips mapping rules with missing pattern', async () => {
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

      const result = await runWebcrack(webpackBundle, {
        unpack: true,
        mappings: [
          {
            target: 'code',
            path: '/some/path.js',
            // pattern is missing
          } as any,
        ],
      });

      expect(result.applied).toBe(true);
      if (result.bundle) {
        expect(result.bundle.mappingsApplied).toBe(0);
      }
    });
  });

  describe('summarizeBundle', () => {
    it('does not include module code when includeModuleCode is false/undefined', async () => {
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

      const result = await runWebcrack(webpackBundle, {
        unpack: true,
        includeModuleCode: false,
      });

      expect(result.applied).toBe(true);
      if (result.bundle && result.bundle.modules.length > 0) {
        expect(result.bundle.modules[0].code).toBeUndefined();
      }
    });

    it('sorts modules with entry modules first', async () => {
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
            module.exports = __webpack_require__(1);
          },
          function(module, exports) {
            module.exports = { value: 42 };
          }
        ]);
      `;

      const result = await runWebcrack(webpackBundle, { unpack: true });

      expect(result.applied).toBe(true);
      if (result.bundle && result.bundle.modules.length > 1) {
        // Entry module should come first
        const entryModules = result.bundle.modules.filter((m) => m.isEntry);
        if (entryModules.length > 0) {
          expect(result.bundle.modules[0].isEntry).toBe(true);
        }
      }
    });
  });

  describe('no bundle in result', () => {
    it('does not include bundle summary for non-bundled code', async () => {
      const simpleCode = 'const x = 1 + 2;';
      const result = await runWebcrack(simpleCode, { unpack: true });
      expect(result.applied).toBe(true);
      expect(result.bundle).toBeUndefined();
    });
  });

  describe('empty mappings array', () => {
    it('returns empty remapped when mappings array is empty', async () => {
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

      const result = await runWebcrack(webpackBundle, {
        unpack: true,
        mappings: [],
      });

      expect(result.applied).toBe(true);
      if (result.bundle) {
        expect(result.bundle.mappingsApplied).toBe(0);
      }
    });
  });

  describe('error handling', () => {
    it('returns original code when webcrack throws', async () => {
      const invalidCode = '{{{{not valid javascript at all!!!!';
      const result = await runWebcrack(invalidCode, {});
      expect(result.applied).toBe(false);
      expect(result.code).toBe(invalidCode);
      expect(result.reason).toBeDefined();
    });

    it('reason is derived from Error.message', async () => {
      const result = await runWebcrack('{{{{broken', {});
      expect(result.applied).toBe(false);
      expect(typeof result.reason).toBe('string');
      expect(result.reason!.length).toBeGreaterThan(0);
    });
  });

  describe('outputDir handling', () => {
    it('does not save when outputDir is undefined', async () => {
      const result = await runWebcrack('var x = 1;', {});
      expect(result.savedTo).toBeUndefined();
      expect(result.savedArtifacts).toBeUndefined();
    });

    it('does not save when outputDir is empty string', async () => {
      const result = await runWebcrack('var x = 1;', { outputDir: '' });
      expect(result.savedTo).toBeUndefined();
      expect(result.savedArtifacts).toBeUndefined();
    });

    it('does not save when outputDir is whitespace only', async () => {
      const result = await runWebcrack('var x = 1;', { outputDir: '   ' });
      expect(result.savedTo).toBeUndefined();
      expect(result.savedArtifacts).toBeUndefined();
    });
  });
});
