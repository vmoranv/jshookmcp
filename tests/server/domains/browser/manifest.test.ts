import { beforeEach, describe, expect, it, vi } from 'vitest';

import { manifestTestMocksInstalled } from '../shared/manifest-test-mocks';

void manifestTestMocksInstalled;

describe('server/domains/browser/manifest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('exports a valid domain manifest as default', async () => {
    const { default: manifest } = await import('@server/domains/browser/manifest');

    expect(manifest).toEqual(
      expect.objectContaining({
        kind: 'domain-manifest',
        version: 1,
        domain: 'browser',
        depKey: 'browserHandlers',
        profiles: ['workflow', 'full'],
        ensure: expect.any(Function),
        registrations: expect.any(Array),
      }),
    );
  });

  it('has registrations that each reference the browser domain', async () => {
    const { default: manifest } = await import('@server/domains/browser/manifest');

    expect(manifest.registrations.length).toBeGreaterThan(0);

    manifest.registrations.forEach((reg) => {
      expect(reg.domain).toBe('browser');
      expect(reg.tool).toBeDefined();
      expect(typeof reg.bind).toBe('function');
    });
  });

  it('includes camoufox server tool in registrations', async () => {
    const { default: manifest } = await import('@server/domains/browser/manifest');

    const toolNames = manifest.registrations.map((r) => (r.tool as { name: string }).name);

    expect(toolNames).toContain('camoufox_server');
  });

  it('includes core browser tools in registrations', async () => {
    const { default: manifest } = await import('@server/domains/browser/manifest');

    const toolNames = manifest.registrations.map((r) => (r.tool as { name: string }).name);

    expect(toolNames).toContain('browser_attach');
    expect(toolNames).toContain('browser_launch');
    expect(toolNames).toContain('browser_close');
    expect(toolNames).toContain('browser_status');
    expect(toolNames).toContain('browser_list_tabs');
    expect(toolNames).toContain('browser_select_tab');
    expect(toolNames).toContain('browser_list_cdp_targets');
    expect(toolNames).toContain('browser_attach_cdp_target');
    expect(toolNames).toContain('browser_detach_cdp_target');
    expect(toolNames).toContain('browser_evaluate_cdp_target');
  });

  it('includes page interaction tools in registrations', async () => {
    const { default: manifest } = await import('@server/domains/browser/manifest');

    const toolNames = manifest.registrations.map((r) => (r.tool as { name: string }).name);

    expect(toolNames).toContain('page_navigate');
    expect(toolNames).toContain('page_reload');
    expect(toolNames).toContain('page_click');
    expect(toolNames).toContain('page_type');
    expect(toolNames).toContain('page_screenshot');
    expect(toolNames).toContain('page_evaluate');
  });

  it('includes advanced browser tools in registrations', async () => {
    const { default: manifest } = await import('@server/domains/browser/manifest');

    const toolNames = manifest.registrations.map((r) => (r.tool as { name: string }).name);

    expect(toolNames).toContain('captcha_detect');
    expect(toolNames).toContain('stealth_inject');
    expect(toolNames).toContain('tab_workflow');
    expect(toolNames).toContain('framework_state_extract');
    expect(toolNames).toContain('indexeddb_dump');
    expect(toolNames).toContain('js_heap_search');
  });

  it('includes human behavior simulation tools in registrations', async () => {
    const { default: manifest } = await import('@server/domains/browser/manifest');

    const toolNames = manifest.registrations.map((r) => (r.tool as { name: string }).name);

    expect(toolNames).toContain('human_mouse');
    expect(toolNames).toContain('human_scroll');
    expect(toolNames).toContain('human_typing');
  });

  it('includes captcha solving tools in registrations', async () => {
    const { default: manifest } = await import('@server/domains/browser/manifest');

    const toolNames = manifest.registrations.map((r) => (r.tool as { name: string }).name);

    expect(toolNames).toContain('captcha_vision_solve');
    expect(toolNames).toContain('widget_challenge_solve');
  });

  it('has no duplicate tool names across registrations', async () => {
    const { default: manifest } = await import('@server/domains/browser/manifest');

    const toolNames = manifest.registrations.map((r) => (r.tool as { name: string }).name);

    expect(new Set(toolNames).size).toBe(toolNames.length);
  });

  it('ensure function creates handlers when context has browser core', async () => {
    const { default: manifest } = await import('@server/domains/browser/manifest');

    const ctx = {
      collector: {},
      pageController: {},
      domInspector: {},
      scriptManager: {},
      consoleMonitor: {},
      llm: {},
      browserHandlers: undefined,
    } as any;

    const result = manifest.ensure(ctx);
    expect(result).toBeDefined();
    expect(ctx.browserHandlers).toBeDefined();
  });

  it('ensure function returns existing handlers on subsequent calls', async () => {
    const { default: manifest } = await import('@server/domains/browser/manifest');

    const existingHandlers = { existing: true };
    const ctx = {
      collector: {},
      pageController: {},
      domInspector: {},
      scriptManager: {},
      consoleMonitor: {},
      llm: {},
      browserHandlers: existingHandlers,
    } as any;

    const result = manifest.ensure(ctx);
    expect(result).toBe(existingHandlers);
  });
});
