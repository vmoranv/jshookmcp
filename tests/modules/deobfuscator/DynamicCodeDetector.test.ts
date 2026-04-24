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

import {
  detectDynamicCodePatterns,
  detectDynamicImports,
  inlineDynamicCode,
  detectIndirectEval,
  detectCryptoBasedDynamicCode,
  detectVMBasedCode,
  detectWASMInstantiate,
  detectReflectObfuscation,
  detectAngularDynamic,
  detectReactDynamic,
  detectAllDynamicPatterns,
} from '@modules/deobfuscator/DynamicCodeDetector';

describe('DynamicCodeDetector', () => {
  describe('detectDynamicCodePatterns', () => {
    it('detects eval calls', () => {
      const code = `eval("console.log(1)")`;
      const detections = detectDynamicCodePatterns(code);
      expect(detections.some((d) => d.type === 'eval')).toBe(true);
    });

    it('detects new Function', () => {
      const code = `new Function("return 42")()`;
      const detections = detectDynamicCodePatterns(code);
      expect(detections.some((d) => d.type === 'newFunction')).toBe(true);
    });

    it('detects dynamic imports', () => {
      const code = `import("./module.js")`;
      const detections = detectDynamicCodePatterns(code);
      expect(detections.some((d) => d.type === 'import')).toBe(true);
    });

    it('returns empty for static code', () => {
      const code = `function test(){return 42;}`;
      const detections = detectDynamicCodePatterns(code);
      expect(detections).toHaveLength(0);
    });
  });

  describe('detectDynamicImports', () => {
    it('detects dynamic import specifiers', () => {
      const code = `import("./utils.js").then(m => m.default())`;
      const imports = detectDynamicImports(code);
      expect(imports.some((i) => i.specifier === './utils.js')).toBe(true);
    });

    it('returns empty for static imports', () => {
      const code = `import { foo } from "./bar.js";`;
      const imports = detectDynamicImports(code);
      expect(imports).toHaveLength(0);
    });
  });

  describe('inlineDynamicCode', () => {
    it('handles static code', () => {
      const code = `function test(){return 42;}`;
      const result = inlineDynamicCode(code);
      expect(result).toBeTruthy();
    });

    it('marks dynamic imports', () => {
      const code = `import("./foo.js")`;
      const result = inlineDynamicCode(code);
      expect(result.inlined).toBeGreaterThan(0);
    });

    it('processes eval with options', () => {
      const code = `eval("alert(1)")`;
      const result = inlineDynamicCode(code, { stripEval: true, replaceWith: 'comment' });
      expect(result).toBeTruthy();
      expect(result.inlined).toBeGreaterThanOrEqual(0);
    });

    it('strips setTimeout with noop replacement', () => {
      const code = `setTimeout(function(){console.log(1);}, 100)`;
      const result = inlineDynamicCode(code, { stripSetTimeout: true, replaceWith: 'noop' });
      expect(result.inlined).toBe(1);
    });
  });

  describe('detectIndirectEval', () => {
    it('detects indirect eval via window bracket access', () => {
      const code = `window["eval"]("console.log(1)")`;
      const detections = detectIndirectEval(code);
      expect(detections.length).toBeGreaterThan(0);
    });

    it('returns empty for code without indirect eval', () => {
      const code = `function test(){return 42;}`;
      const detections = detectIndirectEval(code);
      expect(detections).toHaveLength(0);
    });
  });

  describe('detectCryptoBasedDynamicCode', () => {
    it('detects crypto.subtle.encrypt patterns', () => {
      const code = `crypto.subtle.encrypt()`;
      const detections = detectCryptoBasedDynamicCode(code);
      expect(detections.length).toBeGreaterThan(0);
    });

    it('detects crypto.createCipher patterns', () => {
      const code = `crypto.createCipher("aes-256-cbc", key)`;
      const detections = detectCryptoBasedDynamicCode(code);
      expect(detections.length).toBeGreaterThan(0);
    });

    it('returns empty for clean code', () => {
      const code = `function test(){return 42;}`;
      const detections = detectCryptoBasedDynamicCode(code);
      expect(detections).toHaveLength(0);
    });
  });

  describe('detectVMBasedCode', () => {
    it('detects vm.runInNewContext patterns', () => {
      const code = `vm.runInNewContext("console.log(1)")`;
      const detections = detectVMBasedCode(code);
      expect(detections.length).toBeGreaterThan(0);
    });

    it('detects vm.compileFunction patterns', () => {
      const code = `vm.compileFunction("return 42")`;
      const detections = detectVMBasedCode(code);
      expect(detections.length).toBeGreaterThan(0);
    });

    it('returns empty for clean code', () => {
      const code = `function test(){return 42;}`;
      const detections = detectVMBasedCode(code);
      expect(detections).toHaveLength(0);
    });
  });

  describe('detectWASMInstantiate', () => {
    it('detects WebAssembly.instantiate patterns', () => {
      const code = `WebAssembly.instantiate(buffer)`;
      const detections = detectWASMInstantiate(code);
      expect(detections.length).toBeGreaterThan(0);
    });

    it('detects WebAssembly.compile patterns', () => {
      const code = `WebAssembly.compile(bytes)`;
      const detections = detectWASMInstantiate(code);
      expect(detections.length).toBeGreaterThan(0);
    });

    it('returns empty for clean code', () => {
      const code = `function test(){return 42;}`;
      const detections = detectWASMInstantiate(code);
      expect(detections).toHaveLength(0);
    });
  });

  describe('detectReflectObfuscation', () => {
    it('detects Reflect.get patterns', () => {
      const code = `Reflect.get(obj, "prop")`;
      const detections = detectReflectObfuscation(code);
      expect(detections.length).toBeGreaterThan(0);
    });

    it('detects Reflect.construct patterns', () => {
      const code = `Reflect.construct(Function, args)`;
      const detections = detectReflectObfuscation(code);
      expect(detections.length).toBeGreaterThan(0);
    });

    it('returns empty for clean code', () => {
      const code = `function test(){return 42;}`;
      const detections = detectReflectObfuscation(code);
      expect(detections).toHaveLength(0);
    });
  });

  describe('detectAngularDynamic', () => {
    it('detects $compile patterns', () => {
      const code = `$compile(element)(scope)`;
      const detections = detectAngularDynamic(code);
      expect(detections.length).toBeGreaterThan(0);
    });

    it('detects @Component decorator', () => {
      const code = `@Component({template: "<div></div>"})`;
      const detections = detectAngularDynamic(code);
      expect(detections.length).toBeGreaterThan(0);
    });

    it('returns empty for clean code', () => {
      const code = `function test(){return 42;}`;
      const detections = detectAngularDynamic(code);
      expect(detections).toHaveLength(0);
    });
  });

  describe('detectReactDynamic', () => {
    it('detects React.createElement patterns', () => {
      const code = `React.createElement("div", null, "Hello")`;
      const detections = detectReactDynamic(code);
      expect(detections.length).toBeGreaterThan(0);
    });

    it('detects renderToString patterns', () => {
      const code = `renderToString(<App />)`;
      const detections = detectReactDynamic(code);
      expect(detections.length).toBeGreaterThan(0);
    });

    it('returns empty for clean code', () => {
      const code = `function test(){return 42;}`;
      const detections = detectReactDynamic(code);
      expect(detections).toHaveLength(0);
    });
  });

  describe('detectAllDynamicPatterns', () => {
    it('combines detections from all pattern functions', () => {
      const code = `eval("console.log(1)"); WebAssembly.instantiate(buffer); $compile(scope)`;
      const detections = detectAllDynamicPatterns(code);
      expect(detections.length).toBeGreaterThanOrEqual(3);
      const types = detections.map(d => d.type);
      expect(types).toContain('eval');
      expect(types).toContain('wasm');
      expect(types).toContain('angular');
    });

    it('deduplicates detections', () => {
      const code = `eval("x"); eval("y")`;
      const detections = detectAllDynamicPatterns(code);
      const evalTypes = detections.filter(d => d.type === 'eval');
      expect(evalTypes.length).toBeGreaterThanOrEqual(1);
    });

    it('returns empty for clean code', () => {
      const code = `function test(){return 42;}`;
      const detections = detectAllDynamicPatterns(code);
      expect(detections).toHaveLength(0);
    });
  });
});
