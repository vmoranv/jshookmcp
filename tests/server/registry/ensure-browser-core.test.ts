import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  CodeCollector: vi.fn(function (this: any, config: any) {
    this.kind = 'collector';
    this.config = config;
  }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  PageController: vi.fn(function (this: any, collector: any) {
    this.kind = 'pageController';
    this.collector = collector;
  }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  DOMInspector: vi.fn(function (this: any, collector: any) {
    this.kind = 'domInspector';
    this.collector = collector;
  }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  ScriptManager: vi.fn(function (this: any, collector: any) {
    this.kind = 'scriptManager';
    this.collector = collector;
  }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  ConsoleMonitor: vi.fn(function (this: any, collector: any) {
    this.kind = 'consoleMonitor';
    this.collector = collector;
  }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  LLMService: vi.fn(function (this: any, config: any) {
    this.kind = 'llm';
    this.config = config;
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@modules/collector/CodeCollector', () => ({
  CodeCollector: state.CodeCollector,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@modules/collector/PageController', () => ({
  PageController: state.PageController,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@modules/collector/DOMInspector', () => ({
  DOMInspector: state.DOMInspector,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@modules/debugger/ScriptManager', () => ({
  ScriptManager: state.ScriptManager,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@modules/monitor/ConsoleMonitor', () => ({
  ConsoleMonitor: state.ConsoleMonitor,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@services/LLMService', () => ({
  LLMService: state.LLMService,
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
    expect(state.LLMService).toHaveBeenCalledWith({ model: 'gpt-test' });
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
    expect(state.LLMService).not.toHaveBeenCalled();
    expect(ctx.registerCaches).not.toHaveBeenCalled();
    expect(ctx.collector).toBe(collector);
  });
});
