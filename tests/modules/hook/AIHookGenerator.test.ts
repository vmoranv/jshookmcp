import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: loggerState,
}));

import { AIHookGenerator } from '../../../src/modules/hook/AIHookGenerator.js';

describe('AIHookGenerator', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.values(loggerState).forEach((fn) => (fn as any).mockReset?.());
  });

  it('generates function hook with argument/return capture', () => {
    const generator = new AIHookGenerator();
    const result = generator.generateHook({
      description: 'hook login',
      target: { type: 'function', name: 'login' },
      behavior: { captureArgs: true, captureReturn: true, logToConsole: true },
    } as any);

    expect(result.success).toBe(true);
    expect(result.injectionMethod).toBe('evaluateOnNewDocument');
    expect(result.generatedCode).toContain('window.login');
    expect(result.generatedCode).toContain('args: args');
  });

  it('generates fetch API hook script', () => {
    const generator = new AIHookGenerator();
    const result = generator.generateHook({
      description: 'hook fetch',
      target: { type: 'api', name: 'fetch' },
      behavior: { captureArgs: true, captureReturn: true, logToConsole: true },
      condition: { urlPattern: '/api/' },
    } as any);

    expect(result.success).toBe(true);
    expect(result.generatedCode).toContain('window.fetch');
    expect(result.generatedCode).toContain('urlPattern');
  });

  it('uses evaluate injection for event hooks', () => {
    const generator = new AIHookGenerator();
    const result = generator.generateHook({
      description: 'hook click',
      target: { type: 'event', name: 'click' },
      behavior: { captureArgs: true, logToConsole: true },
      condition: { maxCalls: 2 },
    } as any);

    expect(result.success).toBe(true);
    expect(result.injectionMethod).toBe('evaluate');
    expect(result.generatedCode).toContain('addEventListener');
  });

  it('passes through custom replace code for custom hooks', () => {
    const generator = new AIHookGenerator();
    const result = generator.generateHook({
      description: 'custom',
      target: { type: 'custom' },
      behavior: {},
      customCode: { replace: 'window.__custom = true;' },
    } as any);

    expect(result.success).toBe(true);
    expect(result.generatedCode).toContain('window.__custom = true');
    expect(result.explanation).toContain('Custom Hook');
  });

  it('returns failure payload for unsupported target type', () => {
    const generator = new AIHookGenerator();
    const result = generator.generateHook({
      description: 'bad',
      target: { type: 'not-supported' },
      behavior: {},
    } as any);

    expect(result.success).toBe(false);
    expect(result.warnings).toContain('Hook generation failed');
  });

  it('adds validation warnings for dangerous or malformed code', () => {
    const generator = new AIHookGenerator();
    const result = generator.generateHook({
      description: 'danger',
      target: { type: 'custom' },
      behavior: {},
      customCode: { replace: 'eval("x"); {' },
    } as any);

    expect(result.success).toBe(true);
    expect(result.warnings?.some((w) => w.includes('eval'))).toBe(true);
    expect(result.warnings?.some((w) => w.includes('unmatched braces'))).toBe(true);
  });

  it('creates unique hook ids for consecutive requests', () => {
    const generator = new AIHookGenerator();
    const a = generator.generateHook({
      description: 'a',
      target: { type: 'custom' },
      behavior: {},
      customCode: { replace: '1;' },
    } as any);
    const b = generator.generateHook({
      description: 'b',
      target: { type: 'custom' },
      behavior: {},
      customCode: { replace: '2;' },
    } as any);

    expect(a.hookId).not.toBe(b.hookId);
  });
});

