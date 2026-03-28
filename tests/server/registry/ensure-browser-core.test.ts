import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  CodeCollector: vi.fn(function (this: any, config: any) {
    this.kind = 'collector';
    this.config = config;
  }),
  PageController: vi.fn(function (this: any, collector: any) {
    this.kind = 'pageController';
    this.collector = collector;
  }),
  DOMInspector: vi.fn(function (this: any, collector: any) {
    this.kind = 'domInspector';
    this.collector = collector;
  }),
  ScriptManager: vi.fn(function (this: any, collector: any) {
    this.kind = 'scriptManager';
    this.collector = collector;
  }),
  ConsoleMonitor: vi.fn(function (this: any, collector: any) {
    this.kind = 'consoleMonitor';
    this.collector = collector;
  }),
}));

vi.mock('@modules/collector/CodeCollector', () => ({
  CodeCollector: state.CodeCollector,
}));

vi.mock('@modules/collector/PageController', () => ({
  PageController: state.PageController,
}));

vi.mock('@modules/collector/DOMInspector', () => ({
  DOMInspector: state.DOMInspector,
}));

vi.mock('@modules/debugger/ScriptManager', () => ({
  ScriptManager: state.ScriptManager,
}));

vi.mock('@modules/monitor/ConsoleMonitor', () => ({
  ConsoleMonitor: state.ConsoleMonitor,
}));

describe('registry/ensure-browser-core', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes missing browser-core dependencies once', async () => {
    const { ensureBrowserCore } = await import('@server/registry/ensure-browser-core');
    const ctx = {
      config: {
        puppeteer: { headless: true },
        llm: { model: 'gpt-test' },
      },
      registerCaches: vi.fn(async () => undefined),
    };

    ensureBrowserCore(ctx as never);

    expect(state.CodeCollector).toHaveBeenCalledWith({ headless: true });
    expect(state.PageController).toHaveBeenCalledTimes(1);
    expect(state.DOMInspector).toHaveBeenCalledTimes(1);
    expect(state.ScriptManager).toHaveBeenCalledTimes(1);
    expect(state.ConsoleMonitor).toHaveBeenCalledTimes(1);
    expect(ctx.registerCaches).toHaveBeenCalledTimes(1);
  });

  it('does not overwrite existing browser-core dependencies', async () => {
    const { ensureBrowserCore } = await import('@server/registry/ensure-browser-core');
    const collector = { existing: true };
    const ctx = {
      config: {
        puppeteer: {},
        llm: {},
      },
      collector,
      pageController: { existing: 'page' },
      domInspector: { existing: 'dom' },
      scriptManager: { existing: 'script' },
      consoleMonitor: { existing: 'console' },
      llm: { existing: 'llm' },
      registerCaches: vi.fn(),
    };

    ensureBrowserCore(ctx as never);

    expect(state.CodeCollector).not.toHaveBeenCalled();
    expect(state.PageController).not.toHaveBeenCalled();
    expect(state.DOMInspector).not.toHaveBeenCalled();
    expect(state.ScriptManager).not.toHaveBeenCalled();
    expect(state.ConsoleMonitor).not.toHaveBeenCalled();
    expect(ctx.registerCaches).not.toHaveBeenCalled();
    expect(ctx.collector).toBe(collector);
  });
});
