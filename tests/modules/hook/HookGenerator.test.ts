import { describe, expect, it } from 'vitest';
import {
  generateFunctionHook,
  generateHookChain,
  generateHookScript,
  getInjectionInstructions,
} from '../../../src/modules/hook/HookGenerator.js';

describe('HookGenerator', () => {
  it('generateHookScript dispatches function hook generation', () => {
    const script = generateHookScript('window.alert', 'function', 'log');
    expect(script).toContain('const originalFunction = window.alert');
    expect(script).toContain("type: 'function'");
  });

  it('generateHookScript supports object-method type', () => {
    const script = generateHookScript('window.localStorage.getItem', 'object-method', 'log');
    expect(script).toContain("const methodName = 'getItem'");
    expect(script).toContain('[Object Hook]');
  });

  it('throws for unsupported hook type', () => {
    expect(() =>
      generateHookScript('window.x', 'not-real-type' as any, 'log')
    ).toThrow('Unsupported hook type');
  });

  it('generateFunctionHook includes condition and performance branches', () => {
    const script = generateFunctionHook(
      'window.fetch',
      'modify',
      'args[0] = "/patched";',
      { maxCalls: 2, minInterval: 10 },
      true
    );

    expect(script).toContain('const maxCalls = 2;');
    expect(script).toContain('const minInterval = 10;');
    expect(script).toContain('const startTime = performance.now();');
    expect(script).toContain('args[0] = "/patched";');
  });

  it('getInjectionInstructions references selected hook type', () => {
    const instructions = getInjectionInstructions('eval');
    expect(instructions).toContain('eval');
    expect(instructions).toContain('page_evaluate');
  });

  it('generateHookChain concatenates hook scripts with summary message', () => {
    const chain = generateHookChain([
      { hookId: '1', script: 'console.log(1);', instructions: 'a' },
      { hookId: '2', script: 'console.log(2);', instructions: 'b' },
    ]);

    expect(chain).toContain('console.log(1);');
    expect(chain).toContain('console.log(2);');
    expect(chain).toContain('All 2 hooks initialized');
  });
});

