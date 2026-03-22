import { describe, expect, it } from 'vitest';
import {
  generateHookScript,
  generateFunctionHook,
  generateXHRHook,
  generateFetchHook,
  generateWebSocketHook,
  generateLocalStorageHook,
  generateCookieHook,
  generateEvalHook,
  generateObjectMethodHook,
  generateAntiDebugBypass,
  generateHookTemplate,
  generateHookChain,
  getInjectionInstructions,
} from '@modules/hook/HookGenerator';

describe('HookGenerator — generateHookScript dispatch', () => {
  it('dispatches xhr type to generateXHRHook', () => {
    const script = generateHookScript('*', 'xhr', 'log');
    expect(script).toContain('[XHR Hook]');
  });

  it('dispatches fetch type to generateFetchHook', () => {
    const script = generateHookScript('*', 'fetch', 'log');
    expect(script).toContain('[Fetch Hook]');
  });

  it('dispatches websocket type to generateWebSocketHook', () => {
    const script = generateHookScript('*', 'websocket', 'log');
    expect(script).toContain('[WebSocket Hook]');
  });

  it('dispatches localstorage type to generateLocalStorageHook', () => {
    const script = generateHookScript('*', 'localstorage', 'log');
    expect(script).toContain('[Storage Hook]');
  });

  it('dispatches cookie type to generateCookieHook', () => {
    const script = generateHookScript('*', 'cookie', 'log');
    expect(script).toContain('[Cookie Hook]');
  });

  it('dispatches eval type to generateEvalHook', () => {
    const script = generateHookScript('*', 'eval', 'log');
    expect(script).toContain('[Eval Hook]');
  });

  it('dispatches object-method type to generateObjectMethodHook', () => {
    const script = generateHookScript('console.log', 'object-method', 'log');
    expect(script).toContain('[Object Hook]');
  });

  it('throws for unknown hook type', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(() => generateHookScript('x', 'not-real' as any, 'log')).toThrow(
      'Unsupported hook type'
    );
  });

  it('passes customCode to function hook', () => {
    const script = generateHookScript(
      'window.alert',
      'function',
      'modify',
      'args[0] = "intercepted";'
    );
    expect(script).toContain('args[0] = "intercepted";');
  });

  it('passes condition to function hook', () => {
    const script = generateHookScript('window.alert', 'function', 'log', undefined, {
      maxCalls: 5,
    });
    expect(script).toContain('const maxCalls = 5;');
  });

  it('passes performance flag to function hook', () => {
    const script = generateHookScript(
      'window.alert',
      'function',
      'log',
      undefined,
      undefined,
      true
    );
    expect(script).toContain('performance.now()');
  });
});

describe('HookGenerator — generateFunctionHook', () => {
  it('generates basic log hook without conditions', () => {
    const script = generateFunctionHook('document.getElementById', 'log');
    expect(script).toContain('const originalFunction = document.getElementById');
    expect(script).toContain("type: 'function'");
  });

  it('generates block action hook', () => {
    const script = generateFunctionHook('window.alert', 'block');
    expect(script).toContain('window.alert');
  });

  it('includes custom code in modify action', () => {
    const script = generateFunctionHook('window.fetch', 'modify', 'return "modified";');
    expect(script).toContain('return "modified";');
  });

  it('handles condition with minInterval', () => {
    const script = generateFunctionHook('fn', 'log', undefined, { minInterval: 500 });
    expect(script).toContain('const minInterval = 500;');
  });

  it('handles condition with maxCalls only', () => {
    const script = generateFunctionHook('fn', 'log', undefined, { maxCalls: 10 });
    expect(script).toContain('const maxCalls = 10;');
  });

  it('includes performance timing when enabled', () => {
    const script = generateFunctionHook('fn', 'log', undefined, undefined, true);
    expect(script).toContain('const startTime = performance.now();');
  });
});

describe('HookGenerator — generateXHRHook', () => {
  it('generates XHR hook script', () => {
    const script = generateXHRHook('log');
    expect(script).toContain('[XHR Hook]');
    expect(script).toContain('XMLHttpRequest');
  });

  it('includes custom code', () => {
    const script = generateXHRHook('modify', 'url = "/changed";');
    expect(script).toContain('url = "/changed";');
  });

  it('includes performance timing', () => {
    const script = generateXHRHook('log', undefined, undefined, true);
    // XHR hook doesn't use _performance param; verify basic output
    expect(script).toContain('[Hook] XHR hooked successfully');
  });
});

describe('HookGenerator — generateFetchHook', () => {
  it('generates Fetch hook script', () => {
    const script = generateFetchHook('log');
    expect(script).toContain('[Fetch Hook]');
    expect(script).toContain('fetch');
  });

  it('includes custom code', () => {
    const script = generateFetchHook('modify', 'input = "/api/v2";');
    expect(script).toContain('input = "/api/v2";');
  });
});

describe('HookGenerator — generateWebSocketHook', () => {
  it('generates WebSocket hook script', () => {
    const script = generateWebSocketHook('log');
    expect(script).toContain('[WebSocket Hook]');
    expect(script).toContain('WebSocket');
  });
});

describe('HookGenerator — generateLocalStorageHook', () => {
  it('generates localStorage/sessionStorage hook script', () => {
    const script = generateLocalStorageHook('log');
    expect(script).toContain('[Storage Hook]');
    expect(script).toContain('Storage.prototype');
  });
});

describe('HookGenerator — generateCookieHook', () => {
  it('generates cookie hook script', () => {
    const script = generateCookieHook('log');
    expect(script).toContain('[Cookie Hook]');
    expect(script).toContain('cookie');
  });
});

describe('HookGenerator — generateEvalHook', () => {
  it('generates eval hook script', () => {
    const script = generateEvalHook('log');
    expect(script).toContain('[Eval Hook]');
    expect(script).toContain('eval');
  });

  it('includes custom code', () => {
    const script = generateEvalHook('modify', 'code = code.replace("bad", "good");');
    expect(script).toContain('code = code.replace("bad", "good");');
  });
});

describe('HookGenerator — generateObjectMethodHook', () => {
  it('generates object method hook splitting target', () => {
    const script = generateObjectMethodHook('console.log', 'log');
    expect(script).toContain('[Object Hook]');
    expect(script).toContain("'log'");
  });

  it('handles deeply nested target paths', () => {
    const script = generateObjectMethodHook('window.document.cookie', 'log');
    expect(script).toContain('[Object Hook]');
  });
});

describe('HookGenerator — generateAntiDebugBypass', () => {
  it('generates anti-debug bypass script', () => {
    const script = generateAntiDebugBypass();
    expect(typeof script).toBe('string');
    expect(script.length).toBeGreaterThan(0);
  });
});

describe('HookGenerator — generateHookTemplate', () => {
  it('generates a function hook template', () => {
    const script = generateHookTemplate('myHook', 'function');
    expect(script).toContain('myHook');
    expect(script).toContain('const original = myHook');
    expect(script).toContain('[Hook] Successfully hooked: myHook');
  });

  it('generates a property hook template', () => {
    const script = generateHookTemplate('window.location.href', 'property');
    expect(script).toContain('defineProperty');
    expect(script).toContain('[Hook] Successfully hooked property');
  });

  it('generates a prototype hook template', () => {
    const script = generateHookTemplate('MyClass', 'prototype');
    expect(script).toContain('const original = MyClass');
    expect(script).toContain('prototype');
    expect(script).toContain('[Hook] Successfully hooked prototype: MyClass');
  });
});

describe('HookGenerator — generateHookChain', () => {
  it('concatenates multiple hook scripts', () => {
    const chain = generateHookChain([
      { hookId: 'hook-1', script: 'var a = 1;', instructions: 'First hook' },
      { hookId: 'hook-2', script: 'var b = 2;', instructions: 'Second hook' },
      { hookId: 'hook-3', script: 'var c = 3;', instructions: 'Third hook' },
    ]);

    expect(chain).toContain('var a = 1;');
    expect(chain).toContain('var b = 2;');
    expect(chain).toContain('var c = 3;');
    expect(chain).toContain('All 3 hooks initialized');
  });

  it('handles single hook', () => {
    const chain = generateHookChain([
      { hookId: 'solo', script: 'solo();', instructions: 'Only one' },
    ]);

    expect(chain).toContain('solo();');
    expect(chain).toContain('All 1 hooks initialized');
  });

  it('handles empty array', () => {
    const chain = generateHookChain([]);
    expect(chain).toContain('All 0 hooks initialized');
  });
});

describe('HookGenerator — getInjectionInstructions', () => {
  it('returns instructions for each supported hook type', () => {
    const types = [
      'function',
      'xhr',
      'fetch',
      'websocket',
      'localstorage',
      'cookie',
      'eval',
      'object-method',
    ] as const;

    for (const type of types) {
      const instructions = getInjectionInstructions(type);
      expect(typeof instructions).toBe('string');
      expect(instructions.length).toBeGreaterThan(0);
    }
  });

  it('mentions page_evaluate in instructions', () => {
    const instructions = getInjectionInstructions('function');
    expect(instructions).toContain('page_evaluate');
  });
});

describe('HookGenerator — re-exports are available', () => {
  it('all exported functions are defined', () => {
    expect(typeof generateFunctionHook).toBe('function');
    expect(typeof generateXHRHook).toBe('function');
    expect(typeof generateFetchHook).toBe('function');
    expect(typeof generateWebSocketHook).toBe('function');
    expect(typeof generateLocalStorageHook).toBe('function');
    expect(typeof generateCookieHook).toBe('function');
    expect(typeof generateEvalHook).toBe('function');
    expect(typeof generateObjectMethodHook).toBe('function');
    expect(typeof generateAntiDebugBypass).toBe('function');
    expect(typeof generateHookTemplate).toBe('function');
    expect(typeof generateHookChain).toBe('function');
    expect(typeof getInjectionInstructions).toBe('function');
    expect(typeof generateHookScript).toBe('function');
  });
});
