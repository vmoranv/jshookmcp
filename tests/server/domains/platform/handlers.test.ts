import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  miniapp: {
    handleMiniappPkgScan: vi.fn(async (args) => ({ kind: 'miniapp_scan', args })),
    handleMiniappPkgUnpack: vi.fn(async (args) => ({ kind: 'miniapp_unpack', args })),
    handleMiniappPkgAnalyze: vi.fn(async (args) => ({ kind: 'miniapp_analyze', args })),
  },
  electron: {
    handleAsarExtract: vi.fn(async (args) => ({ kind: 'asar_extract', args })),
    handleElectronInspectApp: vi.fn(async (args) => ({ kind: 'inspect', args })),
    handleAsarSearch: vi.fn(async (args) => ({ kind: 'asar_search', args })),
  },
  bridge: {
    handleFridaBridge: vi.fn(async (args) => ({ kind: 'frida', args })),
    handleJadxBridge: vi.fn(async (args) => ({ kind: 'jadx', args })),
  },
  topLevel: {
    handleElectronScanUserdata: vi.fn(async (args) => ({ kind: 'scan_userdata', args })),
    handleElectronCheckFuses: vi.fn(async (args) => ({ kind: 'check_fuses', args })),
    handleElectronPatchFuses: vi.fn(async (args) => ({ kind: 'patch_fuses', args })),
    handleV8BytecodeDecompile: vi.fn(async (args) => ({ kind: 'v8_bytecode', args })),
    handleElectronLaunchDebug: vi.fn(async (args) => ({ kind: 'launch_debug', args })),
    handleElectronDebugStatus: vi.fn(async (args) => ({ kind: 'debug_status', args })),
    handleElectronIPCSniff: vi.fn(async (args) => ({ kind: 'ipc_sniff', args })),
  },
  toolRegistryCtor: vi.fn(),
  externalRunnerCtor: vi.fn(),
}));

vi.mock('@server/domains/shared/modules', () => ({
  ToolRegistry: function ToolRegistryMock() {
    mocks.toolRegistryCtor();
  },
  ExternalToolRunner: function ExternalToolRunnerMock(registry: any) {
    mocks.externalRunnerCtor(registry);
  },
}));

vi.mock('@src/server/domains/platform/handlers/miniapp-handlers', () => ({
  MiniappHandlers: function MiniappHandlersMock(_runner: any, _collector: any) {
    return {
      ...mocks.miniapp,
    };
  },
}));

vi.mock('@src/server/domains/platform/handlers/electron-handlers', () => ({
  ElectronHandlers: function ElectronHandlersMock(_collector: any) {
    return {
      ...mocks.electron,
    };
  },
}));

vi.mock('@src/server/domains/platform/handlers/bridge-handlers', () => ({
  BridgeHandlers: function BridgeHandlersMock(_runner: any) {
    return {
      ...mocks.bridge,
    };
  },
}));

vi.mock('@server/domains/platform/handlers/electron-userdata-handler', () => ({
  handleElectronScanUserdata: mocks.topLevel.handleElectronScanUserdata,
}));

vi.mock('@server/domains/platform/handlers/electron-fuse-handler', () => ({
  handleElectronCheckFuses: mocks.topLevel.handleElectronCheckFuses,
  handleElectronPatchFuses: mocks.topLevel.handleElectronPatchFuses,
}));

vi.mock('@server/domains/platform/handlers/v8-bytecode-handler', () => ({
  handleV8BytecodeDecompile: mocks.topLevel.handleV8BytecodeDecompile,
}));

vi.mock('@server/domains/platform/handlers/electron-dual-cdp', () => ({
  handleElectronLaunchDebug: mocks.topLevel.handleElectronLaunchDebug,
  handleElectronDebugStatus: mocks.topLevel.handleElectronDebugStatus,
}));

vi.mock('@server/domains/platform/handlers/electron-ipc-sniffer', () => ({
  handleElectronIPCSniff: mocks.topLevel.handleElectronIPCSniff,
}));

import { PlatformToolHandlers } from '@server/domains/platform/handlers';

describe('PlatformToolHandlers', () => {
  const collector = { getActivePage: vi.fn() } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('constructs internal dependencies and handler modules', () => {
    void new PlatformToolHandlers(collector);

    expect(mocks.toolRegistryCtor).toHaveBeenCalledOnce();
    expect(mocks.externalRunnerCtor).toHaveBeenCalledOnce();
    expect(mocks.miniapp.handleMiniappPkgScan).toBeDefined();
    expect(mocks.miniapp.handleMiniappPkgUnpack).toBeDefined();
    expect(mocks.miniapp.handleMiniappPkgAnalyze).toBeDefined();
  });

  it('delegates miniapp package scan', async () => {
    const handlers = new PlatformToolHandlers(collector);
    const args = { path: 'a' };
    await expect(handlers.handleMiniappPkgScan(args)).resolves.toEqual({
      kind: 'miniapp_scan',
      args,
    });
    expect(mocks.miniapp.handleMiniappPkgScan).toHaveBeenCalledWith(args);
  });

  it('delegates miniapp package unpack and analyze', async () => {
    const handlers = new PlatformToolHandlers(collector);
    const unpackArgs = { input: 'app.pkg' };
    const analyzeArgs = { unpackedDir: 'dist' };

    await expect(handlers.handleMiniappPkgUnpack(unpackArgs)).resolves.toEqual({
      kind: 'miniapp_unpack',
      args: unpackArgs,
    });
    await expect(handlers.handleMiniappPkgAnalyze(analyzeArgs)).resolves.toEqual({
      kind: 'miniapp_analyze',
      args: analyzeArgs,
    });
  });

  it('delegates electron handlers and top-level helpers', async () => {
    const handlers = new PlatformToolHandlers(collector);
    const asarArgs = { input: 'app.asar' };
    const inspectArgs = { exePath: 'app.exe' };
    const userdataArgs = { path: 'userdata' };
    const fuseArgs = { inputPath: 'electron.exe' };
    const patchArgs = { inputPath: 'electron.exe' };
    const v8Args = { inputPath: 'bytecode.bin' };
    const launchArgs = { exePath: 'electron.exe' };
    const statusArgs = { sessionId: 'electron-1' };
    const sniffArgs = { action: 'guide' };

    await expect(handlers.handleAsarExtract(asarArgs)).resolves.toEqual({
      kind: 'asar_extract',
      args: asarArgs,
    });
    await expect(handlers.handleElectronInspectApp(inspectArgs)).resolves.toEqual({
      kind: 'inspect',
      args: inspectArgs,
    });
    await expect(handlers.handleElectronScanUserdata(userdataArgs)).resolves.toEqual({
      kind: 'scan_userdata',
      args: userdataArgs,
    });
    await expect(handlers.handleElectronCheckFuses(fuseArgs)).resolves.toEqual({
      kind: 'check_fuses',
      args: fuseArgs,
    });
    await expect(handlers.handleElectronPatchFuses(patchArgs)).resolves.toEqual({
      kind: 'patch_fuses',
      args: patchArgs,
    });
    await expect(handlers.handleV8BytecodeDecompile(v8Args)).resolves.toEqual({
      kind: 'v8_bytecode',
      args: v8Args,
    });
    await expect(handlers.handleElectronLaunchDebug(launchArgs)).resolves.toEqual({
      kind: 'launch_debug',
      args: launchArgs,
    });
    await expect(handlers.handleElectronDebugStatus(statusArgs)).resolves.toEqual({
      kind: 'debug_status',
      args: statusArgs,
    });
    await expect(handlers.handleElectronIPCSniff(sniffArgs)).resolves.toEqual({
      kind: 'ipc_sniff',
      args: sniffArgs,
    });

    expect(mocks.topLevel.handleElectronScanUserdata).toHaveBeenCalledWith(userdataArgs);
    expect(mocks.topLevel.handleElectronCheckFuses).toHaveBeenCalledWith(fuseArgs);
    expect(mocks.topLevel.handleElectronPatchFuses).toHaveBeenCalledWith(patchArgs);
    expect(mocks.topLevel.handleV8BytecodeDecompile).toHaveBeenCalledWith(v8Args);
    expect(mocks.topLevel.handleElectronLaunchDebug).toHaveBeenCalledWith(launchArgs);
    expect(mocks.topLevel.handleElectronDebugStatus).toHaveBeenCalledWith(statusArgs);
    expect(mocks.topLevel.handleElectronIPCSniff).toHaveBeenCalledWith(sniffArgs);
  });

  it('delegates frida bridge and jadx bridge', async () => {
    const handlers = new PlatformToolHandlers(collector);
    const fridaArgs = { cmd: 'hook' };
    const jadxArgs = { dex: 'classes.dex' };

    await expect(handlers.handleFridaBridge(fridaArgs)).resolves.toEqual({
      kind: 'frida',
      args: fridaArgs,
    });
    await expect(handlers.handleJadxBridge(jadxArgs)).resolves.toEqual({
      kind: 'jadx',
      args: jadxArgs,
    });
  });
});
