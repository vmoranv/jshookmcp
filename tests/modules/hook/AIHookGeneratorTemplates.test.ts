import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  generateEventHookTemplate,
  generatePropertyHookTemplate,
} from '@modules/hook/AIHookGeneratorTemplates';

describe('AIHookGeneratorTemplates', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('builds property hook templates with explicit captures and filters', () => {
    const result = generatePropertyHookTemplate(
      {
        target: { object: 'window.appState', property: 'token' },
        behavior: {
          captureArgs: true,
          captureReturn: true,
          captureStack: true,
          logToConsole: true,
          blockExecution: true,
        },
        condition: {
          argFilter: 'args[0] !== null',
        },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      } as any,
      'hook-token'
    );

    expect(result.explanation).toBe(
      'Property hook: window.appState.token (get + set intercepted via Object.defineProperty)'
    );
    expect(result.code).toContain('const targetObject = window.appState;');
    expect(result.code).toContain("const propName = 'token';");
    expect(result.code).toContain('value: value,');
    expect(result.code).toContain('newValue: newValue,');
    expect(result.code).toContain('stack: new Error().stack,');
    expect(result.code).toContain("console.log('[hook-token] Property get:', hookData);");
    expect(result.code).toContain("console.log('[hook-token] Property set:', hookData);");
    expect(result.code).toContain('const args = [newValue];');
    expect(result.code).toContain('try { return args[0] !== null; } catch(e) { return true; }');
    expect(result.code).toContain('if (!true) {');
    expect(result.code).toContain("window.__aiHooks['hook-token'].push(hookData);");
  });

  it('falls back to default property targets and omits optional captures when disabled', () => {
    const result = generatePropertyHookTemplate(
      {
        target: {},
        behavior: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      } as any,
      'hook-default'
    );

    expect(result.explanation).toBe(
      'Property hook: window.unknownProperty (get + set intercepted via Object.defineProperty)'
    );
    expect(result.code).toContain('const targetObject = window;');
    expect(result.code).toContain("const propName = 'unknownProperty';");
    expect(result.code).toContain('if (!false) {');
    expect(result.code).not.toContain('value: value,');
    expect(result.code).not.toContain('newValue: newValue,');
    expect(result.code).not.toContain('stack: new Error().stack,');
  });

  it('builds scoped event hook templates with listener forwarding', () => {
    const result = generateEventHookTemplate(
      {
        target: { name: 'submit' },
        behavior: {
          captureArgs: true,
          captureStack: true,
          logToConsole: true,
          blockExecution: false,
        },
        condition: {
          maxCalls: 3,
        },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      } as any,
      'hook-submit'
    );

    expect(result.explanation).toBe(
      'Event hook: "submit" events via EventTarget.prototype.addEventListener override'
    );
    expect(result.code).toContain("if (type !== 'submit') {");
    expect(result.code).toContain('const maxCalls = 3;');
    expect(result.code).toContain('event: {');
    expect(result.code).toContain('stack: new Error().stack,');
    expect(result.code).toContain("console.log('[hook-submit] Event fired:', hookData);");
    expect(result.code).toContain("if (typeof listener === 'function') {");
    expect(result.code).toContain('listener.handleEvent(event);');
  });

  it('supports unfiltered event hooks that block downstream listener execution', () => {
    const result = generateEventHookTemplate(
      {
        target: {},
        behavior: {
          blockExecution: true,
        },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      } as any,
      'hook-all-events'
    );

    expect(result.explanation).toBe(
      'Event hook: all events via EventTarget.prototype.addEventListener override'
    );
    expect(result.code).not.toContain('if (type !==');
    expect(result.code).toContain('const maxCalls = Infinity;');
    expect(result.code).toContain('// Execution blocked');
    expect(result.code).not.toContain('listener.call(this, event);');
  });
});
