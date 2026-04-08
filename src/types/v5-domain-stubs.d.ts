type StubToolResponse = {
  content: Array<{
    type?: string;
    text: string;
  }>;
};

declare module '@modules/boringssl-inspector/TLSKeyLogExtractor' {
  export interface KeyLogEntry {
    label: string;
    clientRandom: string;
    secret: string;
    timestamp?: string;
  }

  export function enableKeyLog(filePath?: string): string;
  export function disableKeyLog(): void;
  export function getKeyLogFilePath(): string | null;
  export function parseKeyLog(input: string): KeyLogEntry[];
  export function decryptPayload(...args: unknown[]): string;
  export function summarizeKeyLog(entries: KeyLogEntry[]): {
    totalEntries: number;
    uniqueClients: number;
    hasClientRandom: boolean;
    hasTrafficSecrets: boolean;
    labels: string[];
  };
  export function lookupSecret(
    entries: KeyLogEntry[],
    clientRandom: string,
    label?: string,
  ): string | null;
}

declare module '@modules/binary-instrument/types' {
  export interface ExtensionBridgeConfig {
    pluginId: string;
    toolName: string;
    args?: Record<string, unknown>;
  }

  export interface GhidraAnalysisFunction {
    name: string;
    address: string;
    signature: string;
    returnType: string;
    parameters: unknown[];
  }

  export interface GhidraAnalysisOutput {
    functions: GhidraAnalysisFunction[];
    callGraph: unknown[];
    strings: unknown[];
    imports: unknown[];
    decompilations: unknown[];
  }

  export interface HookTemplate {
    functionName: string;
    hookCode: string;
    description: string;
    parameters: unknown[];
  }
}

declare module '@modules/binary-instrument/ExtensionBridge' {
  import type { ExtensionBridgeConfig } from '@modules/binary-instrument/types';

  export function invokePlugin(
    ctx: unknown,
    config: ExtensionBridgeConfig,
  ): Promise<Record<string, unknown>>;
  export function getAvailablePlugins(ctx: unknown): string[];
}

declare module '@modules/binary-instrument/HookCodeGenerator' {
  import type { GhidraAnalysisOutput, HookTemplate } from '@modules/binary-instrument/types';

  export class HookCodeGenerator {
    generateHooks(output: GhidraAnalysisOutput): HookTemplate[];
    exportScript(templates: HookTemplate[], format: string): string;
    exportHookScript(
      templates?: HookTemplate[],
      format?: string,
    ): {
      script: string;
      format: string;
      hookCount: number;
    };
  }
}

declare module '@modules/binary-instrument/UnidbgRunner' {
  export class UnidbgRunner {
    close(): void;
    callFunction(
      sessionId: string,
      functionName: string,
      args: Record<string, unknown>,
    ): Promise<unknown>;
    trace(sessionId: string): Promise<unknown>;
  }
}

declare module '@modules/mojo-ipc/types' {
  export interface MojoMonitorConfig {
    pid?: number;
    processName?: string;
    maxBuffer?: number;
    interfaces?: string[];
  }

  export interface MojoMessage {
    interface: string;
    method?: string;
    pipe?: string;
    timestamp: string | number;
    payload?: string;
    messageId?: string;
  }

  export interface FridaMojoScriptConfig {
    hooks: string[];
    interfaceFilters: string[];
    maxMessages: number;
  }
}

declare module '@modules/mojo-ipc/MojoMonitor' {
  import type { FridaMojoScriptConfig, MojoMonitorConfig } from '@modules/mojo-ipc/types';

  export class MojoMonitor {
    constructor(config?: MojoMonitorConfig);
    start(): Promise<void>;
    stop(): Promise<void>;
    getStore(): unknown;
  }

  export function buildMojoFridaScript(config: FridaMojoScriptConfig): string;
}

declare module '@modules/mojo-ipc/MojoMessageDecoder' {
  export class MojoMessageDecoder {
    decodeMessage(messageHex: string, interfaceName: string): Promise<Record<string, unknown>>;
  }

  export function resolveInterface(interfaceName: string): Record<string, unknown> | null;
  export function listKnownInterfaces(filter?: string): Array<Record<string, unknown>>;
  export function decodeMojoPayload(
    messageHex: string,
    interfaceName: string,
  ): Promise<Record<string, unknown>>;
}

declare module '@modules/syscall-hook/SyscallMonitor' {
  export class SyscallMonitor {
    start(pid: number, maxEvents?: number): Promise<{ sessionId: string }>;
    stop(sessionId: string): Promise<{ eventCount: number }>;
    getEvents(sessionId: string, filter?: string): Promise<unknown[]>;
  }
}

declare module '@server/domains/boringssl-inspector/index' {
  export class BoringSSLInspectorHandlers {
    constructor(extractor?: unknown);
    setExtensionInvoke(invoke: (...args: unknown[]) => Promise<unknown>): void;
    handleTlsKeylogEnable(args: Record<string, unknown>): Promise<unknown>;
    handleTlsKeylogDisable(args: Record<string, unknown>): Promise<unknown>;
    handleTlsKeylogParse(args: Record<string, unknown>): Promise<unknown>;
    handleTlsDecryptPayload(args: Record<string, unknown>): Promise<unknown>;
    handleTlsKeylogSummarize(args: Record<string, unknown>): Promise<unknown>;
    handleTlsKeylogLookupSecret(args: Record<string, unknown>): Promise<unknown>;
    handleTlsCertPinBypass(args: Record<string, unknown>): Promise<unknown>;
    handleTlsHandshakeParse(args: Record<string, unknown>): Promise<unknown>;
    handleKeyLogEnable(args: Record<string, unknown>): Promise<unknown>;
    handleParseHandshake(args: Record<string, unknown>): Promise<unknown>;
    handleCipherSuites(args: Record<string, unknown>): Promise<unknown>;
    handleParseCertificate(args: Record<string, unknown>): Promise<unknown>;
    handleRawTcpSend(args: Record<string, unknown>): Promise<unknown>;
    handleRawTcpListen(args: Record<string, unknown>): Promise<unknown>;
    handleRawTcpScan(args: Record<string, unknown>): Promise<unknown>;
    handleRawUdpSend(args: Record<string, unknown>): Promise<unknown>;
    handleRawUdpListen(args: Record<string, unknown>): Promise<unknown>;
    handleBypassCertPinning(args: Record<string, unknown>): Promise<unknown>;
  }

  export class BoringsslInspectorHandlers extends BoringSSLInspectorHandlers {}
}

declare module '@server/domains/boringssl-inspector/handlers' {
  export class BoringSSLInspectorHandlers {
    constructor(extractor?: unknown);
    setExtensionInvoke(invoke: (...args: unknown[]) => Promise<unknown>): void;
    handleTlsKeylogEnable(args: Record<string, unknown>): Promise<unknown>;
    handleTlsKeylogDisable(args: Record<string, unknown>): Promise<unknown>;
    handleTlsKeylogParse(args: Record<string, unknown>): Promise<unknown>;
    handleTlsDecryptPayload(args: Record<string, unknown>): Promise<unknown>;
    handleTlsKeylogSummarize(args: Record<string, unknown>): Promise<unknown>;
    handleTlsKeylogLookupSecret(args: Record<string, unknown>): Promise<unknown>;
    handleTlsCertPinBypass(args: Record<string, unknown>): Promise<unknown>;
    handleTlsHandshakeParse(args: Record<string, unknown>): Promise<unknown>;
    handleParseHandshake(args: Record<string, unknown>): Promise<unknown>;
    handleCipherSuites(args: Record<string, unknown>): Promise<unknown>;
    handleParseCertificate(args: Record<string, unknown>): Promise<unknown>;
    handleRawTcpSend(args: Record<string, unknown>): Promise<unknown>;
    handleRawTcpListen(args: Record<string, unknown>): Promise<unknown>;
    handleRawTcpScan(args: Record<string, unknown>): Promise<unknown>;
    handleRawUdpSend(args: Record<string, unknown>): Promise<unknown>;
    handleRawUdpListen(args: Record<string, unknown>): Promise<unknown>;
    handleBypassCertPinning(args: Record<string, unknown>): Promise<unknown>;
  }

  export class BoringsslInspectorHandlers extends BoringSSLInspectorHandlers {}
}

declare module '@server/domains/binary-instrument/handlers' {
  export class BinaryInstrumentHandlers {
    constructor(ctx: unknown);
    handleFridaAttach(args: Record<string, unknown>): Promise<StubToolResponse>;
    handleFridaRunScript(args: Record<string, unknown>): Promise<StubToolResponse>;
    handleFridaDetach(args: Record<string, unknown>): Promise<StubToolResponse>;
    handleFridaListSessions(args: Record<string, unknown>): Promise<StubToolResponse>;
    handleFridaGenerateScript(args: Record<string, unknown>): Promise<StubToolResponse>;
    handleGetAvailablePlugins(args: Record<string, unknown>): Promise<StubToolResponse>;
    handleGhidraAnalyze(args: Record<string, unknown>): Promise<StubToolResponse>;
    handleGhidraDecompile(args: Record<string, unknown>): Promise<StubToolResponse>;
    handleIdaDecompile(args: Record<string, unknown>): Promise<StubToolResponse>;
    handleJadxDecompile(args: Record<string, unknown>): Promise<StubToolResponse>;
    handleUnidbgLaunch(args: Record<string, unknown>): Promise<StubToolResponse>;
    handleUnidbgCall(args: Record<string, unknown>): Promise<StubToolResponse>;
    handleUnidbgTrace(args: Record<string, unknown>): Promise<StubToolResponse>;
    handleGenerateHooks(args: Record<string, unknown>): Promise<StubToolResponse>;
    handleExportHookScript(args: Record<string, unknown>): Promise<StubToolResponse>;
  }
}

declare module '@server/domains/mojo-ipc/handlers/impl' {
  export class MojoIPCHandlers {
    constructor();
    handleStart(args: Record<string, unknown>): Promise<StubToolResponse>;
    handleStop(args: Record<string, unknown>): Promise<StubToolResponse>;
    handleGetMessages(args: Record<string, unknown>): Promise<StubToolResponse>;
    handleDecode(args: Record<string, unknown>): Promise<StubToolResponse>;
    handleListInterfaces(args: Record<string, unknown>): Promise<StubToolResponse>;
    getMonitorHandler(): unknown;
    getDecodeHandler(): unknown;
  }
}

declare module '@server/domains/mojo-ipc/handlers' {
  export { MojoIPCHandlers } from '@server/domains/mojo-ipc/handlers/impl';
}

declare module '@server/domains/syscall-hook/handlers.impl' {
  export class SyscallHookHandlers {
    constructor();
    handleSyscallStartMonitor(args: Record<string, unknown>): Promise<Record<string, unknown>>;
    handleSyscallStopMonitor(): Promise<Record<string, unknown>>;
    handleSyscallCaptureEvents(args: Record<string, unknown>): Promise<Record<string, unknown>>;
    handleSyscallCorrelateJs(args: Record<string, unknown>): Promise<Record<string, unknown>>;
    handleSyscallFilter(args: Record<string, unknown>): Promise<Record<string, unknown>>;
    handleSyscallGetStats(): Promise<Record<string, unknown>>;
  }
}

declare module '@server/domains/syscall-hook/handlers' {
  export { SyscallHookHandlers } from '@server/domains/syscall-hook/handlers.impl';
}

declare module '@server/domains/extension-registry/handlers' {
  export class ExtensionRegistryHandlers {
    constructor(ctx: unknown);
    handleExtensionList(args: Record<string, unknown>): Promise<Record<string, unknown>>;
    handleExtensionInstall(args: Record<string, unknown>): Promise<Record<string, unknown>>;
    handleExtensionUninstall(args: Record<string, unknown>): Promise<Record<string, unknown>>;
    handleExtensionInfo(args: Record<string, unknown>): Promise<Record<string, unknown>>;
    handleWebhookCreate(args: Record<string, unknown>): Promise<Record<string, unknown>>;
    handleWebhookList(): Promise<Record<string, unknown>>;
    handleWebhookDelete(args: Record<string, unknown>): Promise<Record<string, unknown>>;
    handleWebhookCommands(args: Record<string, unknown>): Promise<Record<string, unknown>>;
    handleBLEScan(): Promise<Record<string, unknown>>;
    handleBLEHIDCheck(): Promise<Record<string, unknown>>;
    handleBLEHIDSend(args: Record<string, unknown>): Promise<Record<string, unknown>>;
    handleSerialListPorts(): Promise<Record<string, unknown>>;
    handleSerialSend(args: Record<string, unknown>): Promise<Record<string, unknown>>;
    handleSerialFlash(args: Record<string, unknown>): Promise<Record<string, unknown>>;
    shutdown(): Promise<void>;
  }
}

declare module '@src/server/domains/extension-registry/handlers' {
  export { ExtensionRegistryHandlers } from '@server/domains/extension-registry/handlers';
}

declare module '@server/domains/cross-domain/config' {
  export interface CrossDomainConfig {
    fridaEnabled: boolean;
    fridaServerHost: string;
    fridaServerPort: number;
    ghidraEnabled: boolean;
    ghidraHeadlessPath: string | null;
    unidbgEnabled: boolean;
    unidbgJarPath: string | null;
    mojoEnabled: boolean;
    boringsslEnabled: boolean;
    etwEnabled: boolean;
    platform: 'win32' | 'linux' | 'darwin';
  }

  export function getCrossDomainConfig(): CrossDomainConfig;
  export function _resetConfigCache(): void;
}

declare module '@server/domains/cross-domain/handlers/evidence-graph-bridge' {
  export interface CrossDomainNode {
    id: string;
    type: string;
    label: string;
    metadata: Record<string, unknown>;
  }

  export class CrossDomainEvidenceBridge {
    constructor();
    addNode(type: string, label: string, metadata: Record<string, unknown>): CrossDomainNode;
    addV8Object(payload: Record<string, unknown>, scriptNodeId?: string): CrossDomainNode;
    addNetworkRequest(
      payload: Record<string, unknown>,
      initiatorNodeId?: string,
    ): { node: CrossDomainNode };
    addCanvasNode(payload: Record<string, unknown>): CrossDomainNode;
    addSyscallEvent(payload: Record<string, unknown>): CrossDomainNode;
    addMojoMessage(payload: Record<string, unknown>): CrossDomainNode;
    getGraph(): {
      getEdgesFrom(nodeId: string): Array<Record<string, unknown>>;
      exportJson(): { nodes: unknown[]; edges: Array<Record<string, unknown>> };
    };
  }

  export function _resetIdCounter(): void;
}

declare module '@server/domains/cross-domain/handlers/binary-to-js-pipeline' {
  export function buildBinaryToJSPipeline(
    bridge: unknown,
    input: Record<string, unknown>,
    allowList?: string[],
  ): Record<string, unknown>;
}

declare module '@server/domains/cross-domain/handlers/mojo-cdp-correlator' {
  export function correlateMojoToCDP(
    bridge: unknown,
    mojoMessages: unknown[],
    cdpEvents: unknown[],
    networkRequests: unknown[],
  ): Record<string, unknown>;
}

declare module '@server/domains/cross-domain/handlers/skia-correlator' {
  export function correlateSkiaToJS(
    bridge: unknown,
    input: Record<string, unknown>,
  ): Record<string, unknown>;
}

declare module '@server/domains/cross-domain/handlers/syscall-js-correlator' {
  export function correlateSyscallToJS(
    bridge: unknown,
    syscallEvents: unknown[],
    jsStacks: unknown[],
  ): Record<string, unknown>;
}

declare module '@server/domains/cross-domain/handlers' {
  import type { CrossDomainEvidenceBridge } from '@server/domains/cross-domain/handlers/evidence-graph-bridge';

  export class CrossDomainHandlers {
    constructor(ctx: unknown, bridge?: CrossDomainEvidenceBridge);
    handleCapabilities(args: Record<string, unknown>): Promise<StubToolResponse>;
    handleSuggestWorkflow(args: Record<string, unknown>): Promise<StubToolResponse>;
    handleEvidenceExport(args?: Record<string, unknown>): Promise<StubToolResponse>;
    handleEvidenceStats(args?: Record<string, unknown>): Promise<StubToolResponse>;
    handleCorrelateAll(args: Record<string, unknown>): Promise<StubToolResponse>;
  }
}
