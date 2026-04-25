import type { CodeCollector } from '@server/domains/shared/modules';
import { ExternalToolRunner } from '@server/domains/shared/modules';
import { ToolRegistry } from '@server/domains/shared/modules';
import { MiniappHandlers } from '@server/domains/platform/handlers/miniapp-handlers';
import { ElectronHandlers } from '@server/domains/platform/handlers/electron-handlers';
import { handleElectronScanUserdata } from '@server/domains/platform/handlers/electron-userdata-handler';
import {
  handleElectronCheckFuses,
  handleElectronPatchFuses,
} from '@server/domains/platform/handlers/electron-fuse-handler';
import { handleV8BytecodeDecompile } from '@server/domains/platform/handlers/v8-bytecode-handler';
import {
  handleElectronLaunchDebug,
  handleElectronDebugStatus,
} from '@server/domains/platform/handlers/electron-dual-cdp';
import { handleElectronIPCSniff } from '@server/domains/platform/handlers/electron-ipc-sniffer';
import { handlePlatformCapabilities } from '@server/domains/platform/handlers/capabilities';

export class PlatformToolHandlers {
  private miniapp: MiniappHandlers;
  private electron: ElectronHandlers;
  private runner: ExternalToolRunner;

  constructor(collector: CodeCollector) {
    const registry = new ToolRegistry();
    this.runner = new ExternalToolRunner(registry);

    this.miniapp = new MiniappHandlers(this.runner, collector);
    this.electron = new ElectronHandlers(collector);
  }

  handlePlatformCapabilities() {
    return handlePlatformCapabilities(this.runner);
  }

  handleMiniappPkgScan(args: Record<string, unknown>) {
    return this.miniapp.handleMiniappPkgScan(args);
  }

  handleMiniappPkgUnpack(args: Record<string, unknown>) {
    return this.miniapp.handleMiniappPkgUnpack(args);
  }

  handleMiniappPkgAnalyze(args: Record<string, unknown>) {
    return this.miniapp.handleMiniappPkgAnalyze(args);
  }

  handleAsarExtract(args: Record<string, unknown>) {
    return this.electron.handleAsarExtract(args);
  }

  handleElectronInspectApp(args: Record<string, unknown>) {
    return this.electron.handleElectronInspectApp(args);
  }

  handleElectronScanUserdata(args: Record<string, unknown>) {
    return handleElectronScanUserdata(args);
  }

  handleAsarSearch(args: Record<string, unknown>) {
    return this.electron.handleAsarSearch(args);
  }

  handleElectronCheckFuses(args: Record<string, unknown>) {
    return handleElectronCheckFuses(args);
  }

  handleElectronPatchFuses(args: Record<string, unknown>) {
    return handleElectronPatchFuses(args);
  }

  handleV8BytecodeDecompile(args: Record<string, unknown>) {
    return handleV8BytecodeDecompile(args);
  }

  handleElectronLaunchDebug(args: Record<string, unknown>) {
    return handleElectronLaunchDebug(args);
  }

  handleElectronDebugStatus(args: Record<string, unknown>) {
    return handleElectronDebugStatus(args);
  }

  handleElectronIPCSniff(args: Record<string, unknown>) {
    return handleElectronIPCSniff(args);
  }
}
