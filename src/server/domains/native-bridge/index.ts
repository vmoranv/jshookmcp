// ── Types ──

import {
  GHIDRA_BRIDGE_ENDPOINT,
  IDA_BRIDGE_ENDPOINT,
  NATIVE_BRIDGE_TIMEOUT_MS,
} from '@src/constants';
import { handleSafe, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import { asJsonResponse, serializeError } from '@server/domains/shared/response';
export * from './definitions';
export { default } from './manifest';

const RIZIN_BRIDGE_ENDPOINT = 'http://127.0.0.1:18082';
const BINARY_NINJA_BRIDGE_ENDPOINT = 'http://127.0.0.1:18083';

interface BridgeResponse {
  status: number;
  data: unknown;
}

const GHIDRA_ACTIONS = [
  'status',
  'open_project',
  'list_functions',
  'decompile_function',
  'run_script',
  'get_xrefs',
  'search_strings',
  'get_segments',
] as const;

const IDA_ACTIONS = [
  'status',
  'open_binary',
  'list_functions',
  'decompile_function',
  'run_script',
  'get_xrefs',
  'search_strings',
  'get_strings',
  'get_segments',
] as const;

const RIZIN_ACTIONS = [
  'status',
  'open_binary',
  'analyze',
  'list_functions',
  'disassemble_function',
  'run_command',
  'get_xrefs',
  'search_strings',
  'get_segments',
] as const;

const BINARY_NINJA_ACTIONS = [
  'status',
  'open_binary',
  'list_functions',
  'decompile_function',
  'disassemble_function',
  'run_script',
  'get_xrefs',
  'search_strings',
  'get_strings',
  'get_segments',
  'get_types',
] as const;

type BridgeBackend = 'ghidra' | 'ida' | 'rizin' | 'binaryninja';

// ── Helpers ──

function toErrorResponse(tool: string, error: unknown, extra: Record<string, unknown> = {}) {
  return asJsonResponse({ ...serializeError(error), tool, ...extra });
}

async function bridgeFetch(
  baseUrl: string,
  path: string,
  method = 'GET',
  body?: string,
): Promise<BridgeResponse> {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`;
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body }),
    signal: AbortSignal.timeout(NATIVE_BRIDGE_TIMEOUT_MS),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function checkBridgeHealth(
  endpoint: string,
  label: BridgeBackend,
): Promise<Record<string, unknown>> {
  try {
    const { status, data } = await bridgeFetch(endpoint, '/health');
    const advertised = await checkBridgeCapabilities(endpoint, label);
    return {
      backend: label,
      available: status === 200,
      endpoint,
      version: data,
      capabilities: advertised.actions,
      capabilitySource: advertised.source,
    };
  } catch (error) {
    return {
      backend: label,
      available: false,
      endpoint,
      error: error instanceof Error ? error.message : String(error),
      capabilities: getStaticActions(label),
      capabilitySource: 'static',
    };
  }
}

async function checkBridgeCapabilities(
  endpoint: string,
  backend: BridgeBackend,
): Promise<{ actions: string[]; source: 'remote' | 'static' }> {
  try {
    const { status, data } = await bridgeFetch(endpoint, '/capabilities');
    if (status >= 200 && status < 300) {
      const remoteActions = parseCapabilityActions(data);
      if (remoteActions.length > 0) {
        return { actions: remoteActions, source: 'remote' };
      }
    }
  } catch (error) {
    void error;
    // Older bridge servers may not implement /capabilities.
  }
  return { actions: getStaticActions(backend), source: 'static' };
}

function getStaticActions(backend: BridgeBackend): string[] {
  switch (backend) {
    case 'ghidra':
      return [...GHIDRA_ACTIONS];
    case 'ida':
      return [...IDA_ACTIONS];
    case 'rizin':
      return [...RIZIN_ACTIONS];
    case 'binaryninja':
      return [...BINARY_NINJA_ACTIONS];
  }
}

function parseCapabilityActions(data: unknown): string[] {
  if (Array.isArray(data)) {
    return data.filter((item): item is string => typeof item === 'string');
  }
  if (!data || typeof data !== 'object') {
    return [];
  }

  const record = data as Record<string, unknown>;
  for (const key of ['actions', 'capabilities', 'supportedActions']) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string');
    }
  }
  return [];
}

// ── Endpoint validation ──

function validateLoopbackEndpoint(endpoint: string, label: string): void {
  const parsed = new URL(endpoint);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label}: only http/https protocols allowed, got ${parsed.protocol}`);
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const isLoopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  if (!isLoopback) {
    throw new Error(
      `${label}: only loopback addresses allowed (127.0.0.1/localhost/::1), got ${host}`,
    );
  }
}

// ── Handler class ──

export class NativeBridgeHandlers {
  private readonly ghidraEndpoint: string;
  private readonly idaEndpoint: string;
  private readonly rizinEndpoint: string;
  private readonly binaryNinjaEndpoint: string;

  constructor(
    ghidraEndpoint = GHIDRA_BRIDGE_ENDPOINT,
    idaEndpoint = IDA_BRIDGE_ENDPOINT,
    rizinEndpoint = RIZIN_BRIDGE_ENDPOINT,
    binaryNinjaEndpoint = BINARY_NINJA_BRIDGE_ENDPOINT,
  ) {
    // Validate endpoints are loopback only (SSRF protection)
    validateLoopbackEndpoint(ghidraEndpoint, 'Ghidra bridge');
    validateLoopbackEndpoint(idaEndpoint, 'IDA bridge');
    validateLoopbackEndpoint(rizinEndpoint, 'Rizin bridge');
    validateLoopbackEndpoint(binaryNinjaEndpoint, 'Binary Ninja bridge');
    this.ghidraEndpoint = ghidraEndpoint;
    this.idaEndpoint = idaEndpoint;
    this.rizinEndpoint = rizinEndpoint;
    this.binaryNinjaEndpoint = binaryNinjaEndpoint;
  }

  /** Endpoints are fixed at construction; user args cannot override them. */
  private getGhidraEndpoint(_args: Record<string, unknown>): string {
    return this.ghidraEndpoint;
  }

  private getIdaEndpoint(_args: Record<string, unknown>): string {
    return this.idaEndpoint;
  }

  private getRizinEndpoint(_args: Record<string, unknown>): string {
    return this.rizinEndpoint;
  }

  private getBinaryNinjaEndpoint(_args: Record<string, unknown>): string {
    return this.binaryNinjaEndpoint;
  }

  handleNativeBridgeStatusTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(() => this.handleNativeBridgeStatus(args));
  }

  handleGhidraBridgeTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(() => this.handleGhidraBridge(args));
  }

  handleIdaBridgeTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(() => this.handleIdaBridge(args));
  }

  handleRizinBridgeTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(() => this.handleRizinBridge(args));
  }

  handleBinaryNinjaBridgeTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(() => this.handleBinaryNinjaBridge(args));
  }

  handleNativeSymbolSyncTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(() => this.handleNativeSymbolSync(args));
  }

  async handleNativeBridgeStatus(args: Record<string, unknown>) {
    const backend = (args.backend as string) || 'all';
    const results: Record<string, unknown>[] = [];

    if (backend === 'ghidra' || backend === 'all') {
      results.push(await checkBridgeHealth(this.getGhidraEndpoint(args), 'ghidra'));
    }
    if (backend === 'ida' || backend === 'all') {
      results.push(await checkBridgeHealth(this.getIdaEndpoint(args), 'ida'));
    }
    if (backend === 'rizin' || backend === 'all') {
      results.push(await checkBridgeHealth(this.getRizinEndpoint(args), 'rizin'));
    }
    if (backend === 'binaryninja' || backend === 'all') {
      results.push(await checkBridgeHealth(this.getBinaryNinjaEndpoint(args), 'binaryninja'));
    }

    return asJsonResponse({
      success: true,
      backends: results,
      hint:
        'Install bridge servers: Ghidra → ghidra_bridge, IDA → ida_bridge, ' +
        'Rizin → local rizin/r2 bridge, Binary Ninja → local Binary Ninja bridge',
    });
  }

  async handleGhidraBridge(args: Record<string, unknown>) {
    const action = args.action as string;
    const endpoint = this.getGhidraEndpoint(args);

    if (!action) {
      return toErrorResponse('ghidra_bridge', new Error('action is required'));
    }

    try {
      switch (action) {
        case 'status':
          return asJsonResponse(await checkBridgeHealth(endpoint, 'ghidra'));

        case 'open_project': {
          const binaryPath = args.binaryPath as string;
          if (!binaryPath) throw new Error('binaryPath is required for open_project');
          const { status, data } = await bridgeFetch(
            endpoint,
            '/project/open',
            'POST',
            JSON.stringify({ binaryPath }),
          );
          return asJsonResponse({ success: status < 300, action, result: data });
        }

        case 'list_functions': {
          const { status, data } = await bridgeFetch(endpoint, '/functions');
          return asJsonResponse({ success: status < 300, action, functions: data });
        }

        case 'decompile_function': {
          const name = args.functionName as string;
          if (!name) throw new Error('functionName is required for decompile_function');
          const { status, data } = await bridgeFetch(
            endpoint,
            `/functions/${encodeURIComponent(name)}/decompile`,
          );
          return asJsonResponse({
            success: status < 300,
            action,
            functionName: name,
            decompiled: data,
          });
        }

        case 'run_script': {
          const scriptPath = args.scriptPath as string;
          if (!scriptPath) throw new Error('scriptPath is required for run_script');
          const { status, data } = await bridgeFetch(
            endpoint,
            '/script/run',
            'POST',
            JSON.stringify({ scriptPath, args: args.scriptArgs ?? [] }),
          );
          return asJsonResponse({ success: status < 300, action, result: data });
        }

        case 'get_xrefs': {
          const name = args.functionName as string;
          if (!name) throw new Error('functionName is required for get_xrefs');
          const { status, data } = await bridgeFetch(
            endpoint,
            `/xrefs/${encodeURIComponent(name)}`,
          );
          return asJsonResponse({ success: status < 300, action, symbol: name, xrefs: data });
        }

        case 'search_strings': {
          const pattern = args.searchPattern as string;
          const { status, data } = await bridgeFetch(
            endpoint,
            '/strings',
            'POST',
            JSON.stringify({ pattern: pattern ?? '' }),
          );
          return asJsonResponse({ success: status < 300, action, strings: data });
        }

        case 'get_segments': {
          const { status, data } = await bridgeFetch(endpoint, '/segments');
          return asJsonResponse({ success: status < 300, action, segments: data });
        }

        default:
          return asJsonResponse({
            success: true,
            guide: {
              what: 'Ghidra is an open-source SRE framework by NSA.',
              actions: [...GHIDRA_ACTIONS],
              bridgeSetup: [
                'pip install ghidra_bridge',
                'In Ghidra: File → Run Script → ghidra_bridge_server.py',
                'Default endpoint: http://127.0.0.1:18080',
              ],
              links: ['https://ghidra-sre.org/', 'https://github.com/justfoxing/ghidra_bridge'],
            },
          });
      }
    } catch (error) {
      return toErrorResponse('ghidra_bridge', error, { action, endpoint });
    }
  }

  async handleIdaBridge(args: Record<string, unknown>) {
    const action = args.action as string;
    const endpoint = this.getIdaEndpoint(args);

    if (!action) {
      return toErrorResponse('ida_bridge', new Error('action is required'));
    }

    try {
      switch (action) {
        case 'status':
          return asJsonResponse(await checkBridgeHealth(endpoint, 'ida'));

        case 'open_binary': {
          const binaryPath = args.binaryPath as string;
          if (!binaryPath) throw new Error('binaryPath is required for open_binary');
          const { status, data } = await bridgeFetch(
            endpoint,
            '/binary/open',
            'POST',
            JSON.stringify({ binaryPath }),
          );
          return asJsonResponse({ success: status < 300, action, result: data });
        }

        case 'list_functions': {
          const { status, data } = await bridgeFetch(endpoint, '/functions');
          return asJsonResponse({ success: status < 300, action, functions: data });
        }

        case 'decompile_function': {
          const name = args.functionName as string;
          if (!name) throw new Error('functionName is required for decompile_function');
          const { status, data } = await bridgeFetch(
            endpoint,
            `/functions/${encodeURIComponent(name)}/decompile`,
          );
          return asJsonResponse({
            success: status < 300,
            action,
            functionName: name,
            decompiled: data,
          });
        }

        case 'run_script': {
          const scriptPath = args.scriptPath as string;
          if (!scriptPath) throw new Error('scriptPath is required for run_script');
          const { status, data } = await bridgeFetch(
            endpoint,
            '/script/run',
            'POST',
            JSON.stringify({ scriptPath, args: args.scriptArgs ?? [] }),
          );
          return asJsonResponse({ success: status < 300, action, result: data });
        }

        case 'get_xrefs': {
          const name = args.functionName as string;
          if (!name) throw new Error('functionName is required for get_xrefs');
          const { status, data } = await bridgeFetch(
            endpoint,
            `/xrefs/${encodeURIComponent(name)}`,
          );
          return asJsonResponse({ success: status < 300, action, symbol: name, xrefs: data });
        }

        case 'get_strings': {
          const { status, data } = await bridgeFetch(endpoint, '/strings');
          return asJsonResponse({ success: status < 300, action, strings: data });
        }

        case 'search_strings': {
          const pattern = args.searchPattern as string;
          const { status, data } = await bridgeFetch(
            endpoint,
            '/strings',
            'POST',
            JSON.stringify({ pattern: pattern ?? '' }),
          );
          return asJsonResponse({ success: status < 300, action, strings: data });
        }

        case 'get_segments': {
          const { status, data } = await bridgeFetch(endpoint, '/segments');
          return asJsonResponse({ success: status < 300, action, segments: data });
        }

        default:
          return asJsonResponse({
            success: true,
            guide: {
              what: 'IDA Pro is a commercial disassembler/decompiler by Hex-Rays.',
              actions: [...IDA_ACTIONS],
              bridgeSetup: [
                'pip install ida_bridge  // or use idalink',
                'In IDA: File → Script file → ida_bridge_server.py',
                'Default endpoint: http://127.0.0.1:18081',
              ],
              links: [
                'https://hex-rays.com/ida-pro/',
                'https://github.com/williballenthin/ida-bridge',
              ],
            },
          });
      }
    } catch (error) {
      return toErrorResponse('ida_bridge', error, { action, endpoint });
    }
  }

  async handleRizinBridge(args: Record<string, unknown>) {
    const action = args.action as string;
    const endpoint = this.getRizinEndpoint(args);

    if (!action) {
      return toErrorResponse('rizin_bridge', new Error('action is required'));
    }

    try {
      switch (action) {
        case 'status':
          return asJsonResponse(await checkBridgeHealth(endpoint, 'rizin'));

        case 'open_binary': {
          const binaryPath = args.binaryPath as string;
          if (!binaryPath) throw new Error('binaryPath is required for open_binary');
          const { status, data } = await bridgeFetch(
            endpoint,
            '/binary/open',
            'POST',
            JSON.stringify({ binaryPath }),
          );
          return asJsonResponse({ success: status < 300, action, result: data });
        }

        case 'analyze': {
          const { status, data } = await bridgeFetch(
            endpoint,
            '/analysis/run',
            'POST',
            JSON.stringify({ level: args.analysisLevel ?? 'default' }),
          );
          return asJsonResponse({ success: status < 300, action, result: data });
        }

        case 'list_functions': {
          const { status, data } = await bridgeFetch(endpoint, '/functions');
          return asJsonResponse({ success: status < 300, action, functions: data });
        }

        case 'disassemble_function': {
          const name = args.functionName as string;
          if (!name) throw new Error('functionName is required for disassemble_function');
          const { status, data } = await bridgeFetch(
            endpoint,
            `/functions/${encodeURIComponent(name)}/disassemble`,
          );
          return asJsonResponse({
            success: status < 300,
            action,
            functionName: name,
            disassembly: data,
          });
        }

        case 'run_command': {
          const command = args.command as string;
          if (!command) throw new Error('command is required for run_command');
          const { status, data } = await bridgeFetch(
            endpoint,
            '/commands/run',
            'POST',
            JSON.stringify({ command }),
          );
          return asJsonResponse({ success: status < 300, action, result: data });
        }

        case 'get_xrefs': {
          const name = args.functionName as string;
          if (!name) throw new Error('functionName is required for get_xrefs');
          const { status, data } = await bridgeFetch(
            endpoint,
            `/xrefs/${encodeURIComponent(name)}`,
          );
          return asJsonResponse({ success: status < 300, action, symbol: name, xrefs: data });
        }

        case 'search_strings': {
          const pattern = args.searchPattern as string;
          const { status, data } = await bridgeFetch(
            endpoint,
            '/strings',
            'POST',
            JSON.stringify({ pattern: pattern ?? '' }),
          );
          return asJsonResponse({ success: status < 300, action, strings: data });
        }

        case 'get_segments': {
          const { status, data } = await bridgeFetch(endpoint, '/segments');
          return asJsonResponse({ success: status < 300, action, segments: data });
        }

        default:
          return asJsonResponse({
            success: true,
            guide: {
              what: 'Rizin/r2 is an open-source reverse engineering framework.',
              actions: [...RIZIN_ACTIONS],
              bridgeSetup: [
                'Start a loopback HTTP bridge that translates these routes to rizin/r2 commands',
                'Default endpoint: http://127.0.0.1:18082',
              ],
              links: ['https://rizin.re/', 'https://github.com/rizinorg/rizin'],
            },
          });
      }
    } catch (error) {
      return toErrorResponse('rizin_bridge', error, { action, endpoint });
    }
  }

  async handleBinaryNinjaBridge(args: Record<string, unknown>) {
    const action = args.action as string;
    const endpoint = this.getBinaryNinjaEndpoint(args);

    if (!action) {
      return toErrorResponse('binary_ninja_bridge', new Error('action is required'));
    }

    try {
      switch (action) {
        case 'status':
          return asJsonResponse(await checkBridgeHealth(endpoint, 'binaryninja'));

        case 'open_binary': {
          const binaryPath = args.binaryPath as string;
          if (!binaryPath) throw new Error('binaryPath is required for open_binary');
          const { status, data } = await bridgeFetch(
            endpoint,
            '/binary/open',
            'POST',
            JSON.stringify({ binaryPath }),
          );
          return asJsonResponse({ success: status < 300, action, result: data });
        }

        case 'list_functions': {
          const { status, data } = await bridgeFetch(endpoint, '/functions');
          return asJsonResponse({ success: status < 300, action, functions: data });
        }

        case 'decompile_function': {
          const name = args.functionName as string;
          if (!name) throw new Error('functionName is required for decompile_function');
          const { status, data } = await bridgeFetch(
            endpoint,
            `/functions/${encodeURIComponent(name)}/decompile`,
          );
          return asJsonResponse({
            success: status < 300,
            action,
            functionName: name,
            decompiled: data,
          });
        }

        case 'disassemble_function': {
          const name = args.functionName as string;
          if (!name) throw new Error('functionName is required for disassemble_function');
          const { status, data } = await bridgeFetch(
            endpoint,
            `/functions/${encodeURIComponent(name)}/disassemble`,
          );
          return asJsonResponse({
            success: status < 300,
            action,
            functionName: name,
            disassembly: data,
          });
        }

        case 'run_script': {
          const scriptPath = args.scriptPath as string;
          if (!scriptPath) throw new Error('scriptPath is required for run_script');
          const { status, data } = await bridgeFetch(
            endpoint,
            '/script/run',
            'POST',
            JSON.stringify({ scriptPath, args: args.scriptArgs ?? [] }),
          );
          return asJsonResponse({ success: status < 300, action, result: data });
        }

        case 'get_xrefs': {
          const name = args.functionName as string;
          if (!name) throw new Error('functionName is required for get_xrefs');
          const { status, data } = await bridgeFetch(
            endpoint,
            `/xrefs/${encodeURIComponent(name)}`,
          );
          return asJsonResponse({ success: status < 300, action, symbol: name, xrefs: data });
        }

        case 'get_strings': {
          const { status, data } = await bridgeFetch(endpoint, '/strings');
          return asJsonResponse({ success: status < 300, action, strings: data });
        }

        case 'search_strings': {
          const pattern = args.searchPattern as string;
          const { status, data } = await bridgeFetch(
            endpoint,
            '/strings',
            'POST',
            JSON.stringify({ pattern: pattern ?? '' }),
          );
          return asJsonResponse({ success: status < 300, action, strings: data });
        }

        case 'get_segments': {
          const { status, data } = await bridgeFetch(endpoint, '/segments');
          return asJsonResponse({ success: status < 300, action, segments: data });
        }

        case 'get_types': {
          const { status, data } = await bridgeFetch(endpoint, '/types');
          return asJsonResponse({ success: status < 300, action, types: data });
        }

        default:
          return asJsonResponse({
            success: true,
            guide: {
              what: 'Binary Ninja is a commercial reverse engineering platform.',
              actions: [...BINARY_NINJA_ACTIONS],
              bridgeSetup: [
                'Run a Binary Ninja plugin that exposes the loopback HTTP bridge routes',
                'Default endpoint: http://127.0.0.1:18083',
              ],
              links: ['https://binary.ninja/'],
            },
          });
      }
    } catch (error) {
      return toErrorResponse('binary_ninja_bridge', error, { action, endpoint });
    }
  }

  async handleNativeSymbolSync(args: Record<string, unknown>) {
    const source = args.source as string;
    if (!source || !['ghidra', 'ida', 'rizin', 'binaryninja'].includes(source)) {
      return toErrorResponse(
        'native_symbol_sync',
        new Error('source must be one of: ghidra, ida, rizin, binaryninja'),
      );
    }

    const endpoint =
      source === 'ghidra'
        ? this.getGhidraEndpoint(args)
        : source === 'ida'
          ? this.getIdaEndpoint(args)
          : source === 'rizin'
            ? this.getRizinEndpoint(args)
            : this.getBinaryNinjaEndpoint(args);

    const sinceHash =
      typeof args.sinceHash === 'string' && args.sinceHash.trim().length > 0
        ? args.sinceHash.trim()
        : '';

    try {
      // Only forward sinceHash when provided so legacy backends see the same
      // body shape they always have (incremental export is opt-in per sync).
      const body: Record<string, unknown> = {
        filter: args.filter ?? '',
        format: args.exportFormat ?? 'json',
      };
      if (sinceHash) {
        body.sinceHash = sinceHash;
      }

      const { status, data } = await bridgeFetch(
        endpoint,
        '/symbols/export',
        'POST',
        JSON.stringify(body),
      );

      // Echo the requested sinceHash; callers persist data.nextSinceHash (or
      // data.hash) returned by the sidecar for the next incremental sync.
      return asJsonResponse({
        success: status < 300,
        source,
        format: args.exportFormat ?? 'json',
        ...(sinceHash ? { sinceHash } : {}),
        symbols: data,
      });
    } catch (error) {
      return toErrorResponse('native_symbol_sync', error, { source, endpoint });
    }
  }
}
