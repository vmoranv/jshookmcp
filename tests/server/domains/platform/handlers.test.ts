import { beforeEach, describe, expect, it, vi } from 'vitest';

const miniappMocks = {
  handleMiniappPkgScan: vi.fn(async (args) => ({ kind: 'miniapp_scan', args })),
  handleMiniappPkgUnpack: vi.fn(async (args) => ({ kind: 'miniapp_unpack', args })),
  handleMiniappPkgAnalyze: vi.fn(async (args) => ({ kind: 'miniapp_analyze', args })),
};
const electronMocks = {
  handleAsarExtract: vi.fn(async (args) => ({ kind: 'asar_extract', args })),
  handleElectronInspectApp: vi.fn(async (args) => ({ kind: 'inspect', args })),
};
const bridgeMocks = {
  handleFridaBridge: vi.fn(async (args) => ({ kind: 'frida', args })),
  handleJadxBridge: vi.fn(async (args) => ({ kind: 'jadx', args })),
};

const toolRegistryCtor = vi.fn();
const externalRunnerCtor = vi.fn();
const miniappCtor = vi.fn(() => miniappMocks);
const electronCtor = vi.fn(() => electronMocks);
const bridgeCtor = vi.fn(() => bridgeMocks);

vi.mock('../../../../src/modules/external/ToolRegistry.js', () => ({
  ToolRegistry: class {
    constructor() {
      toolRegistryCtor();
    }
  },
}));

vi.mock('../../../../src/modules/external/ExternalToolRunner.js', () => ({
  ExternalToolRunner: class {
    constructor(registry: unknown) {
      externalRunnerCtor(registry);
    }
  },
}));

vi.mock('../../../../src/server/domains/platform/handlers/miniapp-handlers.js', () => ({
  MiniappHandlers: class {
    constructor(runner: unknown, collector: unknown) {
      miniappCtor(runner, collector);
      return miniappMocks;
    }
  },
}));

vi.mock('../../../../src/server/domains/platform/handlers/electron-handlers.js', () => ({
  ElectronHandlers: class {
    constructor(collector: unknown) {
      electronCtor(collector);
      return electronMocks;
    }
  },
}));

vi.mock('../../../../src/server/domains/platform/handlers/bridge-handlers.js', () => ({
  BridgeHandlers: class {
    constructor(runner: unknown) {
      bridgeCtor(runner);
      return bridgeMocks;
    }
  },
}));

import { PlatformToolHandlers } from '../../../../src/server/domains/platform/handlers.js';

describe('PlatformToolHandlers', () => {
  const collector = { getActivePage: vi.fn() } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('constructs internal dependencies and handler modules', () => {
    new PlatformToolHandlers(collector);

    expect(toolRegistryCtor).toHaveBeenCalledOnce();
    expect(externalRunnerCtor).toHaveBeenCalledOnce();
    expect(miniappCtor).toHaveBeenCalledOnce();
    expect(electronCtor).toHaveBeenCalledWith(collector);
    expect(bridgeCtor).toHaveBeenCalledOnce();
  });

  it('delegates miniapp package scan', async () => {
    const handlers = new PlatformToolHandlers(collector);
    const args = { path: 'a' };
    await expect(handlers.handleMiniappPkgScan(args)).resolves.toEqual({
      kind: 'miniapp_scan',
      args,
    });
    expect(miniappMocks.handleMiniappPkgScan).toHaveBeenCalledWith(args);
  });

  it('delegates asar extraction', async () => {
    const handlers = new PlatformToolHandlers(collector);
    const args = { input: 'app.asar' };
    await expect(handlers.handleAsarExtract(args)).resolves.toEqual({
      kind: 'asar_extract',
      args,
    });
    expect(electronMocks.handleAsarExtract).toHaveBeenCalledWith(args);
  });

  it('delegates frida bridge', async () => {
    const handlers = new PlatformToolHandlers(collector);
    const args = { cmd: 'hook' };
    await expect(handlers.handleFridaBridge(args)).resolves.toEqual({
      kind: 'frida',
      args,
    });
    expect(bridgeMocks.handleFridaBridge).toHaveBeenCalledWith(args);
  });

  it('delegates jadx bridge', async () => {
    const handlers = new PlatformToolHandlers(collector);
    const args = { dex: 'classes.dex' };
    await expect(handlers.handleJadxBridge(args)).resolves.toEqual({
      kind: 'jadx',
      args,
    });
    expect(bridgeMocks.handleJadxBridge).toHaveBeenCalledWith(args);
  });
});

