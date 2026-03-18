import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  generateAntiDebugBypass,
  generateEvalHook,
  generateFunctionHook,
  generateHookTemplate,
  generateObjectMethodHook,
} from '@modules/hook/HookGeneratorBuilders.core.generators.runtime';

describe('HookGeneratorBuilders.core.generators.runtime', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('generates function hooks with condition, performance and modify branches', () => {
    const script = generateFunctionHook(
      'window.fetch',
      'modify',
      'args[0] = "/patched";',
      { maxCalls: 2, minInterval: 25 },
      true
    );

    expect(script).toContain('const originalFunction = window.fetch;');
    expect(script).toContain('const maxCalls = 2;');
    expect(script).toContain('const minInterval = 25;');
    expect(script).toContain('const startTime = performance.now();');
    expect(script).toContain('const endTime = performance.now();');
    expect(script).toContain('args[0] = "/patched";');
    expect(script).toContain("console.log('[Hook] Function result:', result);");
    expect(script).not.toContain('return undefined;');
  });

  it('supports blocking function hooks without optional condition or performance code', () => {
    const script = generateFunctionHook('window.alert', 'block');

    expect(script).toContain('const originalFunction = window.alert;');
    expect(script).toContain('return undefined;');
    expect(script).not.toContain('let callCount = 0;');
    expect(script).not.toContain('const startTime = performance.now();');
  });

  it('generates eval hooks that wrap eval, Function and timer string handlers', () => {
    const script = generateEvalHook('block', 'window.__patched = true;');

    expect(script).toContain('window.eval = function(code)');
    expect(script).toContain('window.Function = function(...args)');
    expect(script).toContain('window.setTimeout = function(handler, timeout, ...args)');
    expect(script).toContain('window.setInterval = function(handler, timeout, ...args)');
    expect(script).toContain('window.__patched = true;');
    expect(script).toContain('return undefined;');
    expect(script).toContain('return function() {};');
    expect(script).toContain('return 0;');
  });

  it('generates object method hooks for both methods and accessors', () => {
    const script = generateObjectMethodHook(
      'window.localStorage.getItem',
      'block',
      'args[0] = "token";'
    );

    expect(script).toContain("const targetObject = getObjectByPath('window.localStorage');");
    expect(script).toContain("const methodName = 'getItem';");
    expect(script).toContain('targetObject[methodName] = function(...args)');
    expect(script).toContain('Object.defineProperty(targetObject, methodName, {');
    expect(script).toContain('Object.setPrototypeOf(targetObject[methodName], originalMethod);');
    expect(script).toContain('return undefined;');
    expect(script).toContain('args[0] = "token";');
  });

  it('generates anti-debug bypasses for debugger stripping, timing and devtools probes', () => {
    const script = generateAntiDebugBypass();

    expect(script).toContain("code.replace(/debugger\\s*;?/g, '')");
    expect(script).toContain("lastArg.replace(/debugger\\s*;?/g, '')");
    expect(script).toContain("Object.defineProperty(window, 'outerHeight'");
    expect(script).toContain("Object.defineProperty(window, 'outerWidth'");
    expect(script).toContain('Date.now = function()');
    expect(script).toContain("return 'function () { [native code] }';");
    expect(script).toContain("Object.defineProperty(window, 'devtools'");
  });

  it('generates hook templates for function, property and prototype targets', () => {
    const functionTemplate = generateHookTemplate('window.fetch', 'function');
    const propertyTemplate = generateHookTemplate('document.cookie', 'property');
    const prototypeTemplate = generateHookTemplate('window.WebSocket', 'prototype');

    expect(functionTemplate).toContain('const original = window.fetch;');
    expect(propertyTemplate).toContain("Object.getOwnPropertyDescriptor(document, 'cookie')");
    expect(propertyTemplate).toContain("Object.defineProperty(document, 'cookie', {");
    expect(prototypeTemplate).toContain(
      'const methodNames = Object.getOwnPropertyNames(original.prototype);'
    );
    expect(prototypeTemplate).toContain('window.WebSocket.prototype = original.prototype;');
  });
});
