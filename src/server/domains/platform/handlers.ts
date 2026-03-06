import type { CodeCollector } from '@server/domains/shared/modules';
import { ExternalToolRunner } from '@server/domains/shared/modules';
import { ToolRegistry } from '@server/domains/shared/modules';
import { MiniappHandlers } from '@server/domains/platform/handlers/miniapp-handlers';
import { ElectronHandlers } from '@server/domains/platform/handlers/electron-handlers';
import { BridgeHandlers } from '@server/domains/platform/handlers/bridge-handlers';

export class PlatformToolHandlers {
  private miniapp: MiniappHandlers;
  private electron: ElectronHandlers;
  private bridge: BridgeHandlers;

  constructor(collector: CodeCollector) {
    const registry = new ToolRegistry();
    const runner = new ExternalToolRunner(registry);

    this.miniapp = new MiniappHandlers(runner, collector);
    this.electron = new ElectronHandlers(collector);
    this.bridge = new BridgeHandlers(runner);
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

  handleFridaBridge(args: Record<string, unknown>) {
    return this.bridge.handleFridaBridge(args);
  }

  handleJadxBridge(args: Record<string, unknown>) {
    return this.bridge.handleJadxBridge(args);
  }
}
