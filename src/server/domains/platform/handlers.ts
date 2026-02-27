import type { CodeCollector } from '../../../modules/collector/CodeCollector.js';
import { ExternalToolRunner } from '../../../modules/external/ExternalToolRunner.js';
import { ToolRegistry } from '../../../modules/external/ToolRegistry.js';
import { MiniappHandlers } from './handlers/miniapp-handlers.js';
import { ElectronHandlers } from './handlers/electron-handlers.js';
import { BridgeHandlers } from './handlers/bridge-handlers.js';

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
