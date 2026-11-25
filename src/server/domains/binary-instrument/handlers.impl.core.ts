/**
 * BinaryInstrument domain — composition facade.
 *
 * Delegates to specialized handler classes organized by functionality.
 */

import {
  FridaSession,
  GhidraAnalyzer,
  HookCodeGenerator,
  HookGenerator,
  UnidbgRunner,
} from '@modules/binary-instrument';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { BinaryInstrumentState } from './handlers/shared';
import { isServerContext } from './handlers/shared';
import { CapabilityHandlers } from './handlers/capability-handlers';
import { FridaHandlers as FridaSessionHandlers } from './handlers/frida-handlers';
import { JadxHandlers } from './handlers/jadx';
import { UnidbgHandlers } from './handlers/unidbg';
import { GhidraHandlers } from './handlers/ghidra';
import { BinaryScanHandlers } from './handlers/binary-scan';
import { HooksGenerationHandlers } from './handlers/hooks-generation';
import { FridaDexDumpHandlers } from './handlers/frida';
import { ApktoolHandlers } from './handlers/apktool';
import { NativeLibsHandlers } from './handlers/native-libs';
import { RuntimeDumpHandlers } from './handlers/runtime-dump';
import { PluginBridgeHandlers } from './handlers/plugin-bridge';
import { IdaHandlers } from './handlers/ida';

export class BinaryInstrumentHandlers {
  private state: BinaryInstrumentState;
  private capabilities: CapabilityHandlers;
  private fridaSession: FridaSessionHandlers;
  private jadx: JadxHandlers;
  private unidbg: UnidbgHandlers;
  private ghidra: GhidraHandlers;
  private binaryScan: BinaryScanHandlers;
  private hooksGeneration: HooksGenerationHandlers;
  private fridaDexDump: FridaDexDumpHandlers;
  private apktool: ApktoolHandlers;
  private nativeLibs: NativeLibsHandlers;
  private runtimeDump: RuntimeDumpHandlers;
  private pluginBridge: PluginBridgeHandlers;
  private ida: IdaHandlers;

  constructor(
    first?: FridaSession | MCPServerContext,
    second?: GhidraAnalyzer,
    third?: HookGenerator,
  ) {
    this.state = {
      hookCodeGenerator: new HookCodeGenerator(),
      unidbgRunner: new UnidbgRunner(),
    };

    if (first instanceof FridaSession) {
      this.state.fridaSession = first;
    } else if (isServerContext(first)) {
      this.state.context = first;
    }

    if (second) this.state.ghidra = second;
    if (third) this.state.hookGen = third;

    this.capabilities = new CapabilityHandlers(this.state);
    this.fridaSession = new FridaSessionHandlers(this.state);
    this.jadx = new JadxHandlers(this.state);
    this.unidbg = new UnidbgHandlers(this.state);
    this.ghidra = new GhidraHandlers(this.state);
    this.binaryScan = new BinaryScanHandlers();
    this.hooksGeneration = new HooksGenerationHandlers(this.state);
    this.fridaDexDump = new FridaDexDumpHandlers();
    this.apktool = new ApktoolHandlers();
    this.nativeLibs = new NativeLibsHandlers();
    this.runtimeDump = new RuntimeDumpHandlers(this.state);
    this.pluginBridge = new PluginBridgeHandlers(this.state);
    this.ida = new IdaHandlers(this.state);
  }

  handleBinaryInstrumentCapabilities() {
    return this.capabilities.handleBinaryInstrumentCapabilities();
  }
  handleGetAvailablePlugins(args: Record<string, unknown>) {
    return this.pluginBridge.handleGetAvailablePlugins(args);
  }
  handleFridaAttach(args: Record<string, unknown>) {
    return this.fridaSession.handleFridaAttach(args);
  }
  handleFridaSpawn(args: Record<string, unknown>) {
    return this.fridaSession.handleFridaSpawn(args);
  }
  handleFridaEnumerateModules(args: Record<string, unknown>) {
    return this.fridaSession.handleFridaEnumerateModules(args);
  }
  handleFridaRunScript(args: Record<string, unknown>) {
    return this.fridaSession.handleFridaRunScript(args);
  }

  // fallow-ignore-next-line unused-class-member
  handleFridaBreakpointAddress(args: Record<string, unknown>) {
    return this.fridaSession.handleFridaBreakpointAddress(args);
  }

  // fallow-ignore-next-line unused-class-member
  handleFridaBacktrace(args: Record<string, unknown>) {
    return this.fridaSession.handleFridaBacktrace(args);
  }

  // fallow-ignore-next-line unused-class-member
  handleFridaStalkerTrace(args: Record<string, unknown>) {
    return this.fridaSession.handleFridaStalkerTrace(args);
  }
  handleFridaResume(args: Record<string, unknown>) {
    return this.fridaSession.handleFridaResume(args);
  }

  handleFridaListDevices(args: Record<string, unknown>) {
    return this.fridaSession.handleFridaListDevices(args);
  }

  handleFridaListProcesses(args: Record<string, unknown>) {
    return this.fridaSession.handleFridaListProcesses(args);
  }
  handleFridaDetach(args: Record<string, unknown>) {
    return this.fridaSession.handleFridaDetach(args);
  }
  handleFridaListSessions(args: Record<string, unknown>) {
    return this.fridaSession.handleFridaListSessions(args);
  }
  handleFridaGenerateScript(args: Record<string, unknown>) {
    return this.fridaSession.handleFridaGenerateScript(args);
  }
  handleFridaAttachInterceptor(args: Record<string, unknown>) {
    return this.fridaSession.handleFridaAttachInterceptor(args);
  }
  handleFridaEnumerateFunctions(args: Record<string, unknown>) {
    return this.fridaSession.handleFridaEnumerateFunctions(args);
  }
  handleFridaFindSymbols(args: Record<string, unknown>) {
    return this.fridaSession.handleFridaFindSymbols(args);
  }
  handleFridaMemoryScan(args: Record<string, unknown>) {
    return this.fridaSession.handleFridaMemoryScan(args);
  }
  handleFridaMemoryRead(args: Record<string, unknown>) {
    return this.fridaSession.handleFridaMemoryRead(args);
  }
  handleFridaDexDump(args: Record<string, unknown>) {
    return this.fridaDexDump.handleFridaDexDump(args);
  }
  handleJadxDecompile(args: Record<string, unknown>) {
    return this.jadx.handleJadxDecompile(args);
  }
  handleJadxDecompileApk(args: Record<string, unknown>) {
    return this.jadx.handleJadxDecompileApk(args);
  }
  handleJadxSearchCode(args: Record<string, unknown>) {
    return this.jadx.handleJadxSearchCode(args);
  }
  handleApkManifestDump(args: Record<string, unknown>) {
    return this.jadx.handleApkManifestDump(args);
  }
  handleApkManifestQuery(args: Record<string, unknown>) {
    return this.jadx.handleApkManifestQuery(args);
  }
  handleApkStaticTriage(args: Record<string, unknown>) {
    return this.jadx.handleApkStaticTriage(args);
  }
  handleApkDexIntake(args: Record<string, unknown>) {
    return this.jadx.handleApkDexIntake(args);
  }
  handleApktoolDecode(args: Record<string, unknown>) {
    return this.apktool.handleApktoolDecode(args);
  }
  handleApktoolBuild(args: Record<string, unknown>) {
    return this.apktool.handleApktoolBuild(args);
  }
  handleApktoolSign(args: Record<string, unknown>) {
    return this.apktool.handleApktoolSign(args);
  }
  handleApkNativeLibsList(args: Record<string, unknown>) {
    return this.nativeLibs.handleApkNativeLibsList(args);
  }
  handleDexScanFile(args: Record<string, unknown>) {
    return this.binaryScan.handleDexScanFile(args);
  }
  handleBinaryStringsExtract(args: Record<string, unknown>) {
    return this.binaryScan.handleBinaryStringsExtract(args);
  }
  // fallow-ignore-next-line unused-class-member
  handleBinaryEntropyProfile(args: Record<string, unknown>) {
    return this.binaryScan.handleBinaryEntropyProfile(args);
  }

  // fallow-ignore-next-line unused-class-member
  handleBinaryFindXrefs(args: Record<string, unknown>) {
    return this.binaryScan.handleBinaryFindXrefs(args);
  }
  handleGenerateHooks(args: Record<string, unknown>) {
    return this.hooksGeneration.handleGenerateHooks(args);
  }
  handleExportHookScript(args: Record<string, unknown>) {
    return this.hooksGeneration.handleExportHookScript(args);
  }
  handleUnidbgEmulate(args: Record<string, unknown>) {
    return this.unidbg.handleUnidbgEmulate(args);
  }
  handleUnidbgLaunch(args: Record<string, unknown>) {
    return this.unidbg.handleUnidbgLaunch(args);
  }
  handleUnidbgCall(args: Record<string, unknown>) {
    return this.unidbg.handleUnidbgCall(args);
  }
  handleUnidbgTrace(args: Record<string, unknown>) {
    return this.unidbg.handleUnidbgTrace(args);
  }
  handleGhidraAnalyze(args: Record<string, unknown>) {
    return this.ghidra.handleGhidraAnalyze(args);
  }
  handleGhidraDecompile(args: Record<string, unknown>) {
    return this.ghidra.handleGhidraDecompile(args);
  }
  handleIdaDecompile(args: Record<string, unknown>) {
    return this.ida.handleIdaDecompile(args);
  }
  handleAndroidRuntimeDumpSession(args: Record<string, unknown>) {
    return this.runtimeDump.handleAndroidRuntimeDumpSession(args);
  }
}
