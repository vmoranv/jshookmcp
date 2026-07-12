import type { CodeCollector } from '@server/domains/shared/modules/collector';
import { handleSafe, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
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
import { handleElectronVerifyIntegrity } from '@server/domains/platform/handlers/electron-integrity-handler';
import { handleAsarDeobfuscate } from '@server/domains/platform/handlers/asar-deobfuscate-handler';
import { handleAsarRepack } from '@server/domains/platform/handlers/asar-repack-handler';
import { handleElectronVerifySignature } from '@server/domains/platform/handlers/electron-signature-handler';

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

  handlePlatformCapabilitiesTool(): Promise<ToolResponse> {
    return handleSafe(async () => await this.handlePlatformCapabilities());
  }

  handlePlatformCapabilities() {
    return handlePlatformCapabilities(this.runner);
  }

  handleMiniappPkgScanTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleMiniappPkgScan(args));
  }

  handleMiniappPkgScan(args: Record<string, unknown>) {
    return this.miniapp.handleMiniappPkgScan(args);
  }

  handleMiniappPkgUnpackTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleMiniappPkgUnpack(args));
  }

  handleMiniappPkgUnpack(args: Record<string, unknown>) {
    return this.miniapp.handleMiniappPkgUnpack(args);
  }

  handleMiniappPkgAnalyzeTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleMiniappPkgAnalyze(args));
  }

  handleMiniappPkgAnalyze(args: Record<string, unknown>) {
    return this.miniapp.handleMiniappPkgAnalyze(args);
  }

  handleAsarExtractTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleAsarExtract(args));
  }

  handleAsarExtract(args: Record<string, unknown>) {
    return this.electron.handleAsarExtract(args);
  }

  handleElectronInspectAppTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleElectronInspectApp(args));
  }

  handleElectronInspectApp(args: Record<string, unknown>) {
    return this.electron.handleElectronInspectApp(args);
  }

  handleElectronScanUserdataTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleElectronScanUserdata(args));
  }

  handleElectronScanUserdata(args: Record<string, unknown>) {
    return handleElectronScanUserdata(args);
  }

  handleAsarSearchTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleAsarSearch(args));
  }

  handleAsarSearch(args: Record<string, unknown>) {
    return this.electron.handleAsarSearch(args);
  }

  handleElectronCheckFusesTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleElectronCheckFuses(args));
  }

  handleElectronCheckFuses(args: Record<string, unknown>) {
    return handleElectronCheckFuses(args);
  }

  handleElectronPatchFusesTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleElectronPatchFuses(args));
  }

  handleElectronPatchFuses(args: Record<string, unknown>) {
    return handleElectronPatchFuses(args);
  }

  handleV8BytecodeDecompileTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleV8BytecodeDecompile(args));
  }

  handleV8BytecodeDecompile(args: Record<string, unknown>) {
    return handleV8BytecodeDecompile(args);
  }

  handleElectronLaunchDebugTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleElectronLaunchDebug(args));
  }

  handleElectronLaunchDebug(args: Record<string, unknown>) {
    return handleElectronLaunchDebug(args);
  }

  handleElectronDebugStatusTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleElectronDebugStatus(args));
  }

  handleElectronDebugStatus(args: Record<string, unknown>) {
    return handleElectronDebugStatus(args);
  }

  handleElectronIPCSniffTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleElectronIPCSniff(args));
  }

  handleElectronIPCSniff(args: Record<string, unknown>) {
    return handleElectronIPCSniff(args);
  }

  handleElectronVerifyIntegrityTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleElectronVerifyIntegrity(args));
  }

  handleElectronVerifyIntegrity(args: Record<string, unknown>) {
    return handleElectronVerifyIntegrity(args);
  }

  handleAsarDeobfuscateTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleAsarDeobfuscate(args));
  }

  handleAsarDeobfuscate(args: Record<string, unknown>) {
    return handleAsarDeobfuscate(args);
  }

  handleAsarRepackTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleAsarRepack(args));
  }

  handleAsarRepack(args: Record<string, unknown>) {
    return handleAsarRepack(args);
  }

  handleElectronVerifySignatureTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleElectronVerifySignature(args));
  }

  handleElectronVerifySignature(args: Record<string, unknown>) {
    return handleElectronVerifySignature(args);
  }
}
