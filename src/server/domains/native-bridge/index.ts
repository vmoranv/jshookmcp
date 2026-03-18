/* ---------- Types ---------- */

import { GHIDRA_BRIDGE_ENDPOINT, IDA_BRIDGE_ENDPOINT } from '@src/constants';

interface BridgeResponse {
  status: number;
  data: unknown;
}

/* ---------- Helpers ---------- */

function toTextResponse(payload: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function toErrorResponse(tool: string, error: unknown, extra: Record<string, unknown> = {}) {
  return toTextResponse({
    success: false,
    tool,
    error: error instanceof Error ? error.message : String(error),
    ...extra,
  });
}

async function bridgeFetch(
  baseUrl: string,
  path: string,
  method = 'GET',
  body?: string
): Promise<BridgeResponse> {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`;
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function checkBridgeHealth(
  endpoint: string,
  label: string
): Promise<Record<string, unknown>> {
  try {
    const { status, data } = await bridgeFetch(endpoint, '/health');
    return {
      backend: label,
      available: status === 200,
      endpoint,
      version: data,
    };
  } catch (error) {
    return {
      backend: label,
      available: false,
      endpoint,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/* ---------- Endpoint validation ---------- */

function validateLoopbackEndpoint(endpoint: string, label: string): void {
  const parsed = new URL(endpoint);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label}: only http/https protocols allowed, got ${parsed.protocol}`);
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const isLoopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  if (!isLoopback) {
    throw new Error(
      `${label}: only loopback addresses allowed (127.0.0.1/localhost/::1), got ${host}`
    );
  }
}

/* ---------- Handler class ---------- */

export class NativeBridgeHandlers {
  private readonly ghidraEndpoint: string;
  private readonly idaEndpoint: string;

  constructor(ghidraEndpoint = GHIDRA_BRIDGE_ENDPOINT, idaEndpoint = IDA_BRIDGE_ENDPOINT) {
    // Validate endpoints are loopback only (SSRF protection)
    validateLoopbackEndpoint(ghidraEndpoint, 'Ghidra bridge');
    validateLoopbackEndpoint(idaEndpoint, 'IDA bridge');
    this.ghidraEndpoint = ghidraEndpoint;
    this.idaEndpoint = idaEndpoint;
  }

  /** Endpoints are fixed at construction; user args cannot override them. */
  private getGhidraEndpoint(_args: Record<string, unknown>): string {
    return this.ghidraEndpoint;
  }

  private getIdaEndpoint(_args: Record<string, unknown>): string {
    return this.idaEndpoint;
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

    return toTextResponse({
      success: true,
      backends: results,
      hint: 'Install bridge servers: Ghidra → ghidra_bridge (pip install ghidra_bridge), IDA → ida_bridge',
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
          return toTextResponse(await checkBridgeHealth(endpoint, 'ghidra'));

        case 'open_project': {
          const binaryPath = args.binaryPath as string;
          if (!binaryPath) throw new Error('binaryPath is required for open_project');
          const { status, data } = await bridgeFetch(
            endpoint,
            '/project/open',
            'POST',
            JSON.stringify({ binaryPath })
          );
          return toTextResponse({ success: status < 300, action, result: data });
        }

        case 'list_functions': {
          const { status, data } = await bridgeFetch(endpoint, '/functions');
          return toTextResponse({ success: status < 300, action, functions: data });
        }

        case 'decompile_function': {
          const name = args.functionName as string;
          if (!name) throw new Error('functionName is required for decompile_function');
          const { status, data } = await bridgeFetch(
            endpoint,
            `/functions/${encodeURIComponent(name)}/decompile`
          );
          return toTextResponse({
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
            JSON.stringify({ scriptPath, args: args.scriptArgs ?? [] })
          );
          return toTextResponse({ success: status < 300, action, result: data });
        }

        case 'get_xrefs': {
          const name = args.functionName as string;
          if (!name) throw new Error('functionName is required for get_xrefs');
          const { status, data } = await bridgeFetch(
            endpoint,
            `/xrefs/${encodeURIComponent(name)}`
          );
          return toTextResponse({ success: status < 300, action, symbol: name, xrefs: data });
        }

        case 'search_strings': {
          const pattern = args.searchPattern as string;
          const { status, data } = await bridgeFetch(
            endpoint,
            '/strings',
            'POST',
            JSON.stringify({ pattern: pattern ?? '' })
          );
          return toTextResponse({ success: status < 300, action, strings: data });
        }

        default:
          return toTextResponse({
            success: true,
            guide: {
              what: 'Ghidra is an open-source SRE framework by NSA.',
              actions: [
                'status',
                'open_project',
                'list_functions',
                'decompile_function',
                'run_script',
                'get_xrefs',
                'search_strings',
              ],
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
          return toTextResponse(await checkBridgeHealth(endpoint, 'ida'));

        case 'open_binary': {
          const binaryPath = args.binaryPath as string;
          if (!binaryPath) throw new Error('binaryPath is required for open_binary');
          const { status, data } = await bridgeFetch(
            endpoint,
            '/binary/open',
            'POST',
            JSON.stringify({ binaryPath })
          );
          return toTextResponse({ success: status < 300, action, result: data });
        }

        case 'list_functions': {
          const { status, data } = await bridgeFetch(endpoint, '/functions');
          return toTextResponse({ success: status < 300, action, functions: data });
        }

        case 'decompile_function': {
          const name = args.functionName as string;
          if (!name) throw new Error('functionName is required for decompile_function');
          const { status, data } = await bridgeFetch(
            endpoint,
            `/functions/${encodeURIComponent(name)}/decompile`
          );
          return toTextResponse({
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
            JSON.stringify({ scriptPath, args: args.scriptArgs ?? [] })
          );
          return toTextResponse({ success: status < 300, action, result: data });
        }

        case 'get_xrefs': {
          const name = args.functionName as string;
          if (!name) throw new Error('functionName is required for get_xrefs');
          const { status, data } = await bridgeFetch(
            endpoint,
            `/xrefs/${encodeURIComponent(name)}`
          );
          return toTextResponse({ success: status < 300, action, symbol: name, xrefs: data });
        }

        case 'get_strings': {
          const { status, data } = await bridgeFetch(endpoint, '/strings');
          return toTextResponse({ success: status < 300, action, strings: data });
        }

        default:
          return toTextResponse({
            success: true,
            guide: {
              what: 'IDA Pro is a commercial disassembler/decompiler by Hex-Rays.',
              actions: [
                'status',
                'open_binary',
                'list_functions',
                'decompile_function',
                'run_script',
                'get_xrefs',
                'get_strings',
              ],
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

  async handleNativeSymbolSync(args: Record<string, unknown>) {
    const source = args.source as string;
    if (!source || !['ghidra', 'ida'].includes(source)) {
      return toErrorResponse('native_symbol_sync', new Error('source must be "ghidra" or "ida"'));
    }

    const endpoint = source === 'ghidra' ? this.getGhidraEndpoint(args) : this.getIdaEndpoint(args);

    try {
      const { status, data } = await bridgeFetch(
        endpoint,
        '/symbols/export',
        'POST',
        JSON.stringify({
          filter: args.filter ?? '',
          format: args.exportFormat ?? 'json',
        })
      );

      return toTextResponse({
        success: status < 300,
        source,
        format: args.exportFormat ?? 'json',
        symbols: data,
      });
    } catch (error) {
      return toErrorResponse('native_symbol_sync', error, { source, endpoint });
    }
  }
}
