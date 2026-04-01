/**
 * Additional coverage tests for HookGeneratorBuilders.core.generators.runtime.
 *
 * Covers branches not exercised by the existing test file:
 * - generateFunctionHook: condition with defaults (no maxCalls/minInterval), log action
 * - generateEvalHook: log action (non-block), no customCode
 * - generateObjectMethodHook: log action (non-block), no customCode
 * - generateHookTemplate: edge cases in target splitting
 */
import { describe, expect, it } from 'vitest';

import {
  generateAntiDebugBypass,
  generateEvalHook,
  generateFunctionHook,
  generateHookTemplate,
  generateObjectMethodHook,
} from '@modules/hook/HookGeneratorBuilders.core.generators.runtime';

describe('HookGeneratorBuilders.core.generators.runtime — additional coverage', () => {
  // ── generateFunctionHook ─────────────────────────────────────

  describe('generateFunctionHook — additional branches', () => {
    it('generates condition defaults when maxCalls and minInterval are omitted', () => {
      const script = generateFunctionHook('window.test', 'log', undefined, {});

      expect(script).toContain('const maxCalls = Infinity;');
      expect(script).toContain('const minInterval = 0;');
      expect(script).toContain('let callCount = 0;');
      expect(script).toContain('let lastCallTime = 0;');
    });

    it('generates log action without block or modify directives', () => {
      const script = generateFunctionHook('window.test', 'log');

      expect(script).not.toContain('return undefined;');
      expect(script).toContain('const originalFunction = window.test;');
      expect(script).toContain("console.log('[Hook] Function result:', result);");
    });

    it('handles modify action without customCode (empty)', () => {
      const script = generateFunctionHook('window.fn', 'modify');

      expect(script).not.toContain('return undefined;');
      expect(script).toContain('originalFunction.apply(this, args)');
    });

    it('includes error message for non-function targets in the output', () => {
      const script = generateFunctionHook('window.nonexistent', 'log');

      expect(script).toContain(
        "console.error('[Hook] Target is not a function: window.nonexistent');",
      );
    });

    it('includes hook success log message', () => {
      const script = generateFunctionHook('window.myFn', 'log');

      expect(script).toContain("console.log('[Hook] Successfully hooked: window.myFn');");
    });

    it('handles both condition and performance flags together with block action', () => {
      const script = generateFunctionHook(
        'window.fn',
        'block',
        undefined,
        { maxCalls: 3, minInterval: 100 },
        true,
      );

      expect(script).toContain('return undefined;');
      expect(script).toContain('const maxCalls = 3;');
      expect(script).toContain('const minInterval = 100;');
      expect(script).toContain('const startTime = performance.now();');
      expect(script).toContain('const endTime = performance.now();');
    });

    it('wraps output in use strict IIFE', () => {
      const script = generateFunctionHook('window.fn', 'log');

      expect(script).toMatch(/^\(function\(\)/);
      expect(script).toContain("'use strict';");
      expect(script).toMatch(/\}\)\(\);$/);
    });
  });

  // ── generateEvalHook ─────────────────────────────────────────

  describe('generateEvalHook — additional branches', () => {
    it('generates log-only eval hook without block directives', () => {
      const script = generateEvalHook('log');

      expect(script).not.toContain('return undefined;');
      expect(script).not.toContain('return function() {};');
      expect(script).not.toContain('return 0;');
    });

    it('generates eval hook without customCode', () => {
      const script = generateEvalHook('log');

      expect(script).toContain('window.eval = function(code)');
      expect(script).toContain('window.Function = function(...args)');
      expect(script).toContain(
        "console.log('[Eval Hook] Successfully hooked eval, Function, setTimeout, setInterval');",
      );
    });

    it('includes code length limiting logic in eval wrapper', () => {
      const script = generateEvalHook('log');

      expect(script).toContain('code.length > 200');
      expect(script).toContain('code.substring(0, 200)');
    });

    it('includes handler type check for setTimeout', () => {
      const script = generateEvalHook('log');

      expect(script).toContain("if (typeof handler === 'string')");
    });

    it('includes function body length limiting logic', () => {
      const script = generateEvalHook('log');

      expect(script).toContain('functionBody.length > 200');
      expect(script).toContain('functionBody.substring(0, 200)');
    });
  });

  // ── generateObjectMethodHook ─────────────────────────────────

  describe('generateObjectMethodHook — additional branches', () => {
    it('generates log-only object method hook without block/custom directives', () => {
      const script = generateObjectMethodHook('window.console.log', 'log');

      expect(script).toContain("const targetObject = getObjectByPath('window.console');");
      expect(script).toContain("const methodName = 'log';");
      expect(script).not.toContain('return undefined;');
    });

    it('includes error handling in getObjectByPath function', () => {
      const script = generateObjectMethodHook('deep.path.method', 'log');

      expect(script).toContain("if (part === 'window') continue;");
      expect(script).toContain('if (!obj || !(part in obj))');
      expect(script).toContain('return null;');
    });

    it('includes descriptor/prototype fallback logic', () => {
      const script = generateObjectMethodHook('obj.method', 'log');

      expect(script).toContain('Object.getOwnPropertyDescriptor(targetObject, methodName)');
      expect(script).toContain(
        'Object.getOwnPropertyDescriptor(Object.getPrototypeOf(targetObject), methodName)',
      );
    });

    it('includes getter/setter property hook with block action', () => {
      const script = generateObjectMethodHook('obj.prop', 'block');

      // The block action appears in setter branch
      expect(script).toContain("console.log('[Object Hook] getter called: obj.prop');");
      expect(script).toContain("console.log('[Object Hook] setter called: obj.prop'");
    });

    it('handles single-level target path', () => {
      const script = generateObjectMethodHook('method', 'log');

      expect(script).toContain("const targetObject = getObjectByPath('');");
      expect(script).toContain("const methodName = 'method';");
    });
  });

  // ── generateAntiDebugBypass ──────────────────────────────────

  describe('generateAntiDebugBypass — additional checks', () => {
    it('includes setInterval for devtools detection spoofing', () => {
      const script = generateAntiDebugBypass();

      expect(script).toContain('setInterval(function()');
      expect(script).toContain('const threshold = 160;');
    });

    it('wraps in strict-mode IIFE', () => {
      const script = generateAntiDebugBypass();

      expect(script).toMatch(/^\(function\(\)/);
      expect(script).toContain("'use strict';");
    });
  });

  // ── generateHookTemplate ─────────────────────────────────────

  describe('generateHookTemplate — additional branches', () => {
    it('generates property template with deeply nested target', () => {
      const script = generateHookTemplate('window.document.body.style', 'property');

      expect(script).toContain("Object.getOwnPropertyDescriptor(window.document.body, 'style')");
      expect(script).toContain("Object.defineProperty(window.document.body, 'style', {");
    });

    it('generates prototype template with proper prototype wiring', () => {
      const script = generateHookTemplate('MyCustomClass', 'prototype');

      expect(script).toContain('const original = MyCustomClass;');
      expect(script).toContain(
        "if (name !== 'constructor' && typeof instance[name] === 'function')",
      );
      expect(script).toContain('MyCustomClass.prototype = original.prototype;');
    });

    it('generates function template with success log message', () => {
      const script = generateHookTemplate('testFn', 'function');

      expect(script).toContain("console.log('[Hook] Successfully hooked: testFn');");
    });

    it('property template handles property with single segment', () => {
      const script = generateHookTemplate('singleProp', 'property');

      expect(script).toContain("Object.getOwnPropertyDescriptor(, 'singleProp')");
    });
  });
});
