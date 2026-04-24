import { describe, expect, it } from 'vitest';
import {
  WEBPACK_PATTERNS,
  ROLLUP_PATTERNS,
  VITE_PATTERNS,
  BROWSERIFY_PATTERNS,
  ESBUILD_PATTERNS,
  SWC_PATTERNS,
  TERSER_PATTERNS,
  UGLIFYJS_PATTERNS,
  OBFUSCATOR_IO_PATTERNS,
  JSCRAMBLER_PATTERNS,
  JAVASCRIPT_OBFUSCATOR_PATTERNS,
  VM_PROTECTION_PATTERNS,
  ANTI_DEBUG_PATTERNS,
  DYNAMIC_CODE_PATTERNS,
  ENCODE_DECODE_PATTERNS,
  SNOWPACK_PATTERNS,
  FUSEBOX_PATTERNS,
  REQUIREJS_PATTERNS,
  isWebpack,
  isRollup,
  isVite,
  isBrowserify,
} from '@modules/deobfuscator/CommonPatterns';

describe('CommonPatterns', () => {
  describe('WEBPACK_PATTERNS', () => {
    it('detects webpack require pattern', () => {
      expect(WEBPACK_PATTERNS.require.test('__webpack_require__')).toBe(true);
      expect(WEBPACK_PATTERNS.require.test('__webpack_modules__')).toBe(true);
      expect(WEBPACK_PATTERNS.require.test('const x = 1;')).toBe(false);
    });

    it('detects webpack exports pattern', () => {
      expect(WEBPACK_PATTERNS.exports.test('__webpack_exports__')).toBe(true);
      expect(WEBPACK_PATTERNS.exports.test('__webpack_public_path__')).toBe(true);
    });
  });

  describe('ROLLUP_PATTERNS', () => {
    it('detects rollup naming pattern', () => {
      expect(ROLLUP_PATTERNS.naming.test('__rollup_plugin__')).toBe(true);
      expect(ROLLUP_PATTERNS.naming.test('const x = 1;')).toBe(false);
    });

    it('detects rollup esModule flag', () => {
      expect(ROLLUP_PATTERNS.esModule.test('__esModule: true')).toBe(true);
      expect(ROLLUP_PATTERNS.esModule.test('__esModule = true')).toBe(true);
    });
  });

  describe('VITE_PATTERNS', () => {
    it('detects vite globals', () => {
      expect(VITE_PATTERNS.globals.test('__vite')).toBe(true);
      expect(VITE_PATTERNS.globals.test('const __vite = 1;')).toBe(true);
    });

    it('detects vite import.meta', () => {
      expect(VITE_PATTERNS.importMeta.test('import.meta.url')).toBe(true);
    });
  });

  describe('BROWSERIFY_PATTERNS', () => {
    it('detects browserify exports check', () => {
      expect(BROWSERIFY_PATTERNS.exports.test('typeof exports === "object"')).toBe(true);
    });

    it('detects browserify define check', () => {
      expect(BROWSERIFY_PATTERNS.define.test('typeof define === "function"')).toBe(true);
    });
  });

  describe('ESBUILD_PATTERNS', () => {
    it('detects esbuild module patterns', () => {
      expect(ESBUILD_PATTERNS.module.test('__esmProps')).toBe(true);
      expect(ESBUILD_PATTERNS.module.test('__esmDynamic')).toBe(true);
      expect(ESBUILD_PATTERNS.module.test('__esmModule')).toBe(true);
    });

    it('detects esbuild exports patterns', () => {
      expect(ESBUILD_PATTERNS.exports.test('__esExport')).toBe(true);
      expect(ESBUILD_PATTERNS.exports.test('__esDestructuring')).toBe(true);
    });
  });

  describe('SWC_PATTERNS', () => {
    it('detects turbo/rsc patterns', () => {
      expect(SWC_PATTERNS.turbo.test('__TURBO__')).toBe(true);
      expect(SWC_PATTERNS.turbo.test('__RSC__')).toBe(true);
    });

    it('detects swc serialization pattern', () => {
      expect(SWC_PATTERNS.serialized.test('__serialized__')).toBe(true);
    });
  });

  describe('TERSER_PATTERNS', () => {
    it('detects terser pure annotation', () => {
      expect(TERSER_PATTERNS.pureComment.test('/* @__PURE__@ */')).toBe(true);
    });

    it('detects terser license comment', () => {
      expect(TERSER_PATTERNS.licenseComment.test('/* @license terser */')).toBe(true);
    });
  });

  describe('UGLIFYJS_PATTERNS', () => {
    it('detects uglify undefined check', () => {
      expect(UGLIFYJS_PATTERNS.undefinedCheck.test('typeof x === "undefined"')).toBe(true);
    });

    it('detects uglify default object pattern', () => {
      expect(UGLIFYJS_PATTERNS.defaultObject.test('x = x || {}')).toBe(true);
    });
  });

  describe('OBFUSCATOR_IO_PATTERNS', () => {
    it('detects obfuscator.io hex variable', () => {
      expect(OBFUSCATOR_IO_PATTERNS.hexVariable.test('_0x1234 = [1, 2, 3]')).toBe(true);
    });

    it('detects obfuscator.io control flow flattening', () => {
      expect(OBFUSCATOR_IO_PATTERNS.controlFlowFlattening.test('while(!_0x1234){switch(_0x5678){...}}')).toBe(true);
    });
  });

  describe('JSCRAMBLER_PATTERNS', () => {
    it('detects jscrambler markers', () => {
      expect(JSCRAMBLER_PATTERNS.markers.test('jsscrambler')).toBe(true);
      expect(JSCRAMBLER_PATTERNS.markers.test('_jsr_')).toBe(true);
      expect(JSCRAMBLER_PATTERNS.markers.test('__jsf_')).toBe(true);
    });

    it('detects jscrambler dynamic identifiers', () => {
      expect(JSCRAMBLER_PATTERNS.dynamicIdentifiers.test('__dynamic_abc123__')).toBe(true);
    });
  });

  describe('JAVASCRIPT_OBFUSCATOR_PATTERNS', () => {
    it('detects HTML-encoded JavaScript', () => {
      expect(JAVASCRIPT_OBFUSCATOR_PATTERNS.htmlEncoded.test('J&#')).toBe(true);
    });

    it('detects charCode string building', () => {
      expect(JAVASCRIPT_OBFUSCATOR_PATTERNS.charCodeBuilding.test("String.fromCharCode(65) + String.fromCharCode(66)")).toBe(true);
    });
  });

  describe('VM_PROTECTION_PATTERNS', () => {
    it('detects while true switch pattern', () => {
      expect(VM_PROTECTION_PATTERNS.whileTrueSwitch.test('while(true){switch(pc){...}}')).toBe(true);
    });

    it('detects large numeric array', () => {
      expect(VM_PROTECTION_PATTERNS.largeNumericArray.test('var arr = [1,2,3,4,5,6,7,8,9,10,11,12]')).toBe(true);
    });

    it('detects pc access pattern', () => {
      expect(VM_PROTECTION_PATTERNS.pcAccess.test('arr[pc++]')).toBe(true);
    });

    it('detects stack operations', () => {
      expect(VM_PROTECTION_PATTERNS.stackOps.test('stack.push(x)')).toBe(true);
      expect(VM_PROTECTION_PATTERNS.stackOps.test('stack.pop()')).toBe(true);
    });
  });

  describe('ANTI_DEBUG_PATTERNS', () => {
    it('detects debugger statement', () => {
      expect(ANTI_DEBUG_PATTERNS.debuggerKeyword.test('debugger;')).toBe(true);
    });

    it('detects console debug check', () => {
      expect(ANTI_DEBUG_PATTERNS.consoleCheck.test('console["Debug"]')).toBe(true);
    });
  });

  describe('DYNAMIC_CODE_PATTERNS', () => {
    it('detects eval pattern', () => {
      expect(DYNAMIC_CODE_PATTERNS.eval.test('eval("console.log(1)")')).toBe(true);
    });

    it('detects new Function pattern', () => {
      expect(DYNAMIC_CODE_PATTERNS.newFunction.test('new Function("return 1")')).toBe(true);
    });

    it('detects dynamic import', () => {
      expect(DYNAMIC_CODE_PATTERNS.dynamicImport.test('import("./module.js")')).toBe(true);
    });
  });

  describe('ENCODE_DECODE_PATTERNS', () => {
    it('detects hex escape sequences', () => {
      expect(ENCODE_DECODE_PATTERNS.hexEscape.test('\\x48\\x65')).toBe(true);
    });

    it('detects unicode escape sequences', () => {
      expect(ENCODE_DECODE_PATTERNS.unicodeEscape.test('\\u0048\\u0065')).toBe(true);
    });

    it('detects HTML hex entity', () => {
      expect(ENCODE_DECODE_PATTERNS.htmlHexEntity.test('&#x48;')).toBe(true);
    });

    it('detects HTML numeric entity', () => {
      expect(ENCODE_DECODE_PATTERNS.htmlNumericEntity.test('&#72;')).toBe(true);
    });
  });

  describe('SNOWPACK_PATTERNS', () => {
    it('detects snowpack globals', () => {
      expect(SNOWPACK_PATTERNS.globals.test('__snowpack__')).toBe(true);
      expect(SNOWPACK_PATTERNS.globals.test('__SNOWPACK__')).toBe(true);
    });

    it('detects snowpack polyfill', () => {
      expect(SNOWPACK_PATTERNS.polyfill.test('snowpack__polyfill')).toBe(true);
      expect(SNOWPACK_PATTERNS.polyfill.test('snowpack__env')).toBe(true);
    });
  });

  describe('FUSEBOX_PATTERNS', () => {
    it('detects fusebox globals', () => {
      expect(FUSEBOX_PATTERNS.globals.test('__fusebox__')).toBe(true);
      expect(FUSEBOX_PATTERNS.globals.test('__FUSEOBJECT__')).toBe(true);
    });

    it('detects fusebox paths', () => {
      expect(FUSEBOX_PATTERNS.paths.test('fuse.直达')).toBe(true);
      expect(FUSEBOX_PATTERNS.paths.test('fusebox:')).toBe(true);
    });
  });

  describe('REQUIREJS_PATTERNS', () => {
    it('detects requirejs define', () => {
      expect(REQUIREJS_PATTERNS.define.test('require(["a", "b"], function(a, b) {})')).toBe(true);
    });

    it('detects requirejs module', () => {
      expect(REQUIREJS_PATTERNS.module.test('define("moduleName", ["a"], function(a) {})')).toBe(true);
    });

    it('detects requirejs config', () => {
      expect(REQUIREJS_PATTERNS.config.test('requirejs.config({...})')).toBe(true);
      expect(REQUIREJS_PATTERNS.config.test('require.config({...})')).toBe(true);
    });
  });

  describe('helper functions', () => {
    it('isWebpack returns true for webpack code', () => {
      expect(isWebpack('__webpack_require__')).toBe(true);
      expect(isWebpack('installedModules = {}')).toBe(true);
    });

    it('isWebpack returns false for non-webpack code', () => {
      expect(isWebpack('const x = 1')).toBe(false);
    });

    it('isRollup returns true for rollup code', () => {
      expect(isRollup('__rollup_plugin__')).toBe(true);
      expect(isRollup('__esModule: true')).toBe(true);
    });

    it('isVite returns true for vite code', () => {
      expect(isVite('__vite')).toBe(true);
      expect(isVite('import.meta.url')).toBe(true);
    });

    it('isBrowserify returns true for browserify code', () => {
      expect(isBrowserify('typeof exports === "object"')).toBe(true);
      expect(isBrowserify('__browserify_process')).toBe(true);
    });
  });
});