import { describe, it, expect } from 'vitest';
import { buildHookCode } from '@server/domains/hooks/preset-builder';
import type { PresetEntry } from '@server/domains/hooks/preset-builder';

describe('buildHookCode', () => {
  const SAMPLE_BODY = `
  const _orig = window.eval;
  window.eval = function(code) {
    {{STACK_CODE}}
    const __msg = '[Hook:eval] code=' + String(code).substring(0, 200);
    {{LOG_FN}}
    window.__aiHooks['preset-eval'].push({ code: String(code).substring(0, 500), stack: __stack, ts: Date.now() });
    return _orig.call(this, code);
  };`;

  it('returns a string wrapped in an IIFE', () => {
    const code = buildHookCode('test-hook', SAMPLE_BODY, false, false);
    expect(code).toContain('(function() {');
    expect(code).toContain('})();');
  });

  it('sets up the __hookPresets idempotency guard', () => {
    const code = buildHookCode('test-hook', SAMPLE_BODY, false, false);
    expect(code).toContain('if (window.__hookPresets === undefined) window.__hookPresets = {};');
    expect(code).toContain("if (window.__hookPresets['test-hook']) return;");
  });

  it('marks the preset as installed at the end', () => {
    const code = buildHookCode('my-preset', SAMPLE_BODY, false, false);
    expect(code).toContain("window.__hookPresets['my-preset'] = true;");
  });

  it('initialises the __aiHooks collection for the preset', () => {
    const code = buildHookCode('my-preset', SAMPLE_BODY, false, false);
    expect(code).toContain('window.__aiHooks = window.__aiHooks || {};');
    expect(code).toContain(
      "window.__aiHooks['preset-my-preset'] = window.__aiHooks['preset-my-preset'] || [];"
    );
  });

  describe('captureStack parameter', () => {
    it('emits stack-capture code when captureStack is true', () => {
      const code = buildHookCode('test', SAMPLE_BODY, true, false);
      expect(code).toContain(
        "const __stack = new Error().stack?.split('\\n').slice(1,4).join(' | ') || '';"
      );
      expect(code).not.toContain('{{STACK_CODE}}');
    });

    it('emits empty-stack assignment when captureStack is false', () => {
      const code = buildHookCode('test', SAMPLE_BODY, false, false);
      expect(code).toContain("const __stack = '';");
      expect(code).not.toContain('new Error().stack');
      expect(code).not.toContain('{{STACK_CODE}}');
    });
  });

  describe('logToConsole parameter', () => {
    it('emits console.log call when logToConsole is true', () => {
      const code = buildHookCode('test', SAMPLE_BODY, false, true);
      expect(code).toContain("console.log(__msg + (__stack ? ' | Stack: ' + __stack : ''));");
      expect(code).not.toContain('{{LOG_FN}}');
    });

    it('omits console.log call when logToConsole is false', () => {
      const code = buildHookCode('test', SAMPLE_BODY, false, false);
      expect(code).not.toContain('console.log');
      expect(code).not.toContain('{{LOG_FN}}');
    });
  });

  describe('combined captureStack + logToConsole', () => {
    it('emits both stack capture and console.log when both are true', () => {
      const code = buildHookCode('combo', SAMPLE_BODY, true, true);
      expect(code).toContain(
        "const __stack = new Error().stack?.split('\\n').slice(1,4).join(' | ') || '';"
      );
      expect(code).toContain('console.log');
    });

    it('emits neither stack capture nor console.log when both are false', () => {
      const code = buildHookCode('combo', SAMPLE_BODY, false, false);
      expect(code).toContain("const __stack = '';");
      expect(code).not.toContain('console.log');
    });
  });

  it('replaces all {{STACK_CODE}} and {{LOG_FN}} placeholders in multi-occurrence body', () => {
    const multiBody = `
    fn1() { {{STACK_CODE}} {{LOG_FN}} }
    fn2() { {{STACK_CODE}} {{LOG_FN}} }`;
    const code = buildHookCode('multi', multiBody, true, true);
    expect(code).not.toContain('{{STACK_CODE}}');
    expect(code).not.toContain('{{LOG_FN}}');
    // Two stack captures and two log calls
    const stackMatches = code.match(/const __stack = new Error\(\)/g);
    expect(stackMatches).toHaveLength(2);
    const logMatches = code.match(/console\.log\(__msg/g);
    expect(logMatches).toHaveLength(2);
  });

  it('embeds the preset name correctly into generated code', () => {
    const code = buildHookCode('my-custom-name', '{{STACK_CODE}} {{LOG_FN}}', false, false);
    expect(code).toContain("window.__hookPresets['my-custom-name']");
    expect(code).toContain("window.__aiHooks['preset-my-custom-name']");
  });

  it('preserves the body content beyond placeholders', () => {
    const body = `
    {{STACK_CODE}}
    const __msg = 'unique-marker-string';
    {{LOG_FN}}
    doSomething();`;
    const code = buildHookCode('preserve', body, false, false);
    expect(code).toContain('unique-marker-string');
    expect(code).toContain('doSomething();');
  });
});

describe('PresetEntry type contract', () => {
  it('accepts an object conforming to the PresetEntry shape', () => {
    const entry: PresetEntry = {
      description: 'A test preset',
      buildCode: (captureStack: boolean, logToConsole: boolean) =>
        buildHookCode('type-check', '{{STACK_CODE}} {{LOG_FN}}', captureStack, logToConsole),
    };

    expect(entry.description).toBe('A test preset');
    expect(typeof entry.buildCode).toBe('function');

    const code = entry.buildCode(true, false);
    expect(typeof code).toBe('string');
    expect(code).toContain('type-check');
  });
});
