import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  overrideRules: null as
    | Array<{
        pattern: string;
        flags?: string;
        boosts: Array<{ tool: string; bonus: number }>;
      }>
    | null,
}));

vi.mock('@src/constants', () => ({
  get SEARCH_INTENT_TOOL_BOOST_RULES_OVERRIDE() {
    return state.overrideRules;
  },
}));

describe('search/IntentBoost', () => {
  beforeEach(() => {
    vi.resetModules();
    state.overrideRules = null;
  });

  it('uses the built-in default rules when no override is configured', async () => {
    const { IntentBoostImpl } = await import('@server/search/IntentBoost');
    const boost = new IntentBoostImpl();

    expect(boost.resolveIntentToolBonuses('账号注册验证码').get('run_extension_workflow')).toBe(40);
    expect(boost.resolveIntentToolBonuses('抓取接口').get('web_api_capture_session')).toBe(26);
  });

  it('compiles only valid override rules', async () => {
    state.overrideRules = [
      {
        pattern: '[invalid',
        boosts: [{ tool: 'broken', bonus: 10 }],
      },
      {
        pattern: 'hello',
        boosts: [{ tool: '', bonus: 10 }],
      },
      {
        pattern: 'hello',
        boosts: [{ tool: 'custom_tool', bonus: 11 }],
      },
    ];
    const { IntentBoostImpl } = await import('@server/search/IntentBoost');

    expect(IntentBoostImpl.compileIntentToolBoostRules(state.overrideRules)).toEqual([
      {
        pattern: /hello/i,
        boosts: [{ tool: 'custom_tool', bonus: 11 }],
      },
    ]);
  });

  it('takes the maximum bonus when multiple override rules target the same tool', async () => {
    state.overrideRules = [
      {
        pattern: 'hello',
        boosts: [{ tool: 'custom_tool', bonus: 10 }],
      },
      {
        pattern: 'hello world',
        boosts: [{ tool: 'custom_tool', bonus: 25 }],
      },
    ];
    const { IntentBoostImpl } = await import('@server/search/IntentBoost');
    const boost = new IntentBoostImpl();

    expect(boost.resolveIntentToolBonuses('hello world').get('custom_tool')).toBe(25);
    expect(boost.getCompiledRules()).toHaveLength(2);
  });
});
