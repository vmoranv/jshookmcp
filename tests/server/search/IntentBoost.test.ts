import { describe, expect, it } from 'vitest';
import { IntentBoostImpl } from '@server/search/IntentBoost';

describe('search/IntentBoost', () => {
  it('has no built-in rules after the Phase 2 removal', () => {
    const boost = new IntentBoostImpl();

    expect(boost.resolveIntentToolBonuses('register signup verify')).toEqual(new Map());
    expect(boost.resolveIntentToolBonuses('api capture session')).toEqual(new Map());
    expect(boost.getCompiledRules()).toEqual([]);
  });

  it('applies explicit custom rules', () => {
    const boost = new IntentBoostImpl([
      {
        pattern: 'register signup verify',
        boosts: [{ tool: 'run_extension_workflow', bonus: 12 }],
      },
      { pattern: 'api capture session', boosts: [{ tool: 'run_extension_workflow', bonus: 18 }] },
    ]);

    expect(
      boost.resolveIntentToolBonuses('register signup verify').get('run_extension_workflow'),
    ).toBe(12);
    expect(
      boost.resolveIntentToolBonuses('api capture session').get('run_extension_workflow'),
    ).toBe(18);
  });

  it('compiles only valid custom rules', () => {
    const compiled = IntentBoostImpl.compileIntentToolBoostRules([
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
    ]);

    expect(compiled).toEqual([
      {
        pattern: /hello/i,
        boosts: [{ tool: 'custom_tool', bonus: 11 }],
      },
    ]);
  });

  it('takes the maximum bonus when multiple custom rules target the same tool', () => {
    const boost = new IntentBoostImpl([
      {
        pattern: 'hello',
        boosts: [{ tool: 'custom_tool', bonus: 10 }],
      },
      {
        pattern: 'hello world',
        boosts: [{ tool: 'custom_tool', bonus: 25 }],
      },
    ]);

    expect(boost.resolveIntentToolBonuses('hello world').get('custom_tool')).toBe(25);
    expect(boost.getCompiledRules()).toHaveLength(2);
  });

  it('allows an explicit empty custom rule set', () => {
    const boost = new IntentBoostImpl([]);

    expect(boost.resolveIntentToolBonuses('账号注册验证码')).toEqual(new Map());
    expect(boost.getCompiledRules()).toEqual([]);
  });

  it('strips stateful g/y flags so repeated queries are stable', () => {
    const boost = new IntentBoostImpl([
      {
        pattern: 'hello',
        flags: 'gi',
        boosts: [{ tool: 'custom_tool', bonus: 5 }],
      },
      {
        pattern: 'world',
        flags: 'y',
        boosts: [{ tool: 'custom_tool', bonus: 7 }],
      },
    ]);

    for (const rule of boost.getCompiledRules()) {
      expect(rule.pattern.flags).not.toContain('g');
      expect(rule.pattern.flags).not.toContain('y');
    }

    expect(boost.resolveIntentToolBonuses('hello').get('custom_tool')).toBe(5);
    expect(boost.resolveIntentToolBonuses('hello').get('custom_tool')).toBe(5);
    expect(boost.resolveIntentToolBonuses('world').get('custom_tool')).toBe(7);
  });
});
