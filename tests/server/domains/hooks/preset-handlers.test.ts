import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HookPresetToolHandlers } from '@server/domains/hooks/preset-handlers';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('HookPresetToolHandlers', () => {
  const page = {
    evaluateOnNewDocument: vi.fn(),
    evaluate: vi.fn(),
  };

  const pageController = {
    getPage: vi.fn(async () => page),
  };

  let handlers: HookPresetToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new HookPresetToolHandlers(pageController as any);
  });

  it('lists built-in and inline custom presets together', async () => {
    const body = parseJson(
      await handlers.handleHookPreset({
        listPresets: true,
        customTemplate: {
          id: 'deobfuscation-sinks',
          description: 'Trace deobfuscation sinks',
          body: "window.__aiHooks['preset-deobfuscation-sinks'].push({ ts: Date.now() });",
        },
      })
    );

    expect(body.success).toBe(true);
    expect(body.presets.some((preset: { id: string }) => preset.id === 'eval')).toBe(true);
    expect(body.presets.some((preset: { id: string }) => preset.id === 'deobfuscation-sinks')).toBe(
      true
    );
  });

  it('injects an inline custom template through evaluate', async () => {
    const body = parseJson(
      await handlers.handleHookPreset({
        preset: 'zero-trust-fetch',
        customTemplate: {
          id: 'zero-trust-fetch',
          description: 'Trace custom fetch headers',
          body: `
  const _fetch = window.fetch.bind(window);
  window.fetch = function(input, init) {
    {{STACK_CODE}}
    const __msg = '[Hook:zero-trust-fetch]';
    {{LOG_FN}}
    window.__aiHooks['preset-zero-trust-fetch'].push({ input: String(input), headers: JSON.stringify(init?.headers || {}), stack: __stack, ts: Date.now() });
    return _fetch(input, init);
  };`,
        },
        method: 'evaluate',
      })
    );

    expect(body.success).toBe(true);
    expect(body.injected).toEqual(['zero-trust-fetch']);
    expect(page.evaluate).toHaveBeenCalledOnce();
    expect(page.evaluate.mock.calls[0]![0]).toContain('preset-zero-trust-fetch');
  });

  it('rejects custom template ids that collide with built-in presets', async () => {
    const body = parseJson(
      await handlers.handleHookPreset({
        preset: 'eval',
        customTemplate: {
          id: 'eval',
          body: 'console.log(1);',
        },
      })
    );

    expect(body.success).toBe(false);
    expect(body.error).toContain('conflicts with built-in preset');
  });
});
