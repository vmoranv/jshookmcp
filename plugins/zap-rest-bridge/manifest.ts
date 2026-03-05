/**
 * OWASP ZAP REST API bridge plugin.
 *
 * Default endpoint: http://127.0.0.1:8080
 * Docs: https://www.zaproxy.org/docs/api/
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainManifest, ToolHandlerDeps, PluginContract, PluginLifecycleContext, ToolArgs } from '../../src/server/plugin-api.js';
import { getPluginBooleanConfig, loadPluginEnv } from '../../src/server/plugin-api.js';

loadPluginEnv(import.meta.url);

type JsonObject = Record<string, unknown>;
type TextToolResponse = {
  content: Array<{ type: 'text'; text: string }>;
};

/* ---------- Utilities ---------- */

function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const host = url.hostname.replace(/^\[|\]$/g, '');
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch {
    return false;
  }
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  return `${url.protocol}//${url.host}`;
}

function toText(payload: unknown): TextToolResponse {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

function toErr(tool: string, error: unknown, extra: JsonObject = {}): TextToolResponse {
  return toText({
    success: false,
    tool,
    error: error instanceof Error ? error.message : String(error),
    ...extra,
  });
}

function buildZapUrl(baseUrl: string, path: string, query: JsonObject = {}): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${baseUrl.replace(/\/$/, '')}${normalizedPath}`);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function requestJson(
  url: string,
  method = 'GET',
  bodyObj: JsonObject | undefined = undefined,
): Promise<{ status: number; data: JsonObject }> {
  const body = bodyObj ? new URLSearchParams(bodyObj as Record<string, string>).toString() : undefined;
  const res = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let data: JsonObject = {};
  if (text.length > 0) {
    try {
      data = JSON.parse(text) as JsonObject;
    } catch {
      data = { text };
    }
  }
  return { status: res.status, data };
}

/* ---------- Handlers ---------- */

class ZapBridgeHandlers {
  baseUrl: string;
  apiKey?: string;

  constructor(baseUrl = 'http://127.0.0.1:8080', apiKey: string | undefined = undefined) {
    if (!isLoopbackUrl(baseUrl)) {
      throw new Error(
        `ZAP bridge only allows loopback addresses (127.0.0.1/localhost/::1), got "${baseUrl}"`,
      );
    }
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.apiKey = apiKey?.trim() || undefined;
  }

  async handleZapCoreVersion(_args: ToolArgs): Promise<TextToolResponse> {
    try {
      const url = buildZapUrl(this.baseUrl, '/JSON/core/view/version/', {
        apikey: this.apiKey,
      });
      const { status, data } = await requestJson(url, 'GET');
      return toText({
        success: status >= 200 && status < 300,
        endpoint: this.baseUrl,
        status,
        data,
      });
    } catch (error) {
      return toErr('zap_core_version', error, { endpoint: this.baseUrl });
    }
  }

  async handleZapApiCall(args: ToolArgs): Promise<TextToolResponse> {
    const format = String(args.format ?? 'JSON').toUpperCase();
    const component = String(args.component ?? '');
    const callType = String(args.callType ?? 'view');
    const operation = String(args.operation ?? '');
    const method = String(args.method ?? 'GET').toUpperCase();
    const rawParams = args.params;
    const params: JsonObject =
      rawParams && typeof rawParams === 'object' && !Array.isArray(rawParams)
        ? (rawParams as JsonObject)
        : {};

    if (!component || !callType || !operation) {
      return toErr('zap_api_call', new Error('component, callType, and operation are required'));
    }

    try {
      const path = `/${format}/${component}/${callType}/${operation}/`;
      const query = { ...params, apikey: this.apiKey };
      const url = buildZapUrl(this.baseUrl, path, method === 'GET' ? query : {});
      const { status, data } = await requestJson(url, method, method === 'GET' ? undefined : query);

      return toText({
        success: status >= 200 && status < 300,
        endpoint: this.baseUrl,
        path,
        method,
        status,
        data,
      });
    } catch (error) {
      return toErr('zap_api_call', error, { endpoint: this.baseUrl });
    }
  }
}

/* ---------- Tool definitions ---------- */

const zapTools: Tool[] = [
  {
    name: 'zap_core_version',
    description:
      'Get OWASP ZAP version from /JSON/core/view/version/.\n\n' +
      'Uses ZAP REST API endpoint (default http://127.0.0.1:8080).\n' +
      'API key is optional via ZAP_API_KEY.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'zap_api_call',
    description:
      'Generic OWASP ZAP REST API caller.\n\n' +
      'Builds endpoint as /<FORMAT>/<component>/<callType>/<operation>/.\n' +
      'Example: format=JSON, component=core, callType=view, operation=version',
    inputSchema: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['JSON', 'OTHER', 'HTML'],
          description: 'ZAP API format segment (default: JSON)',
          default: 'JSON',
        },
        component: {
          type: 'string',
          description: 'API component, e.g. core, spider, ascan',
        },
        callType: {
          type: 'string',
          enum: ['view', 'action', 'other'],
          description: 'API call type segment',
        },
        operation: {
          type: 'string',
          description: 'Operation name, e.g. version, scan',
        },
        method: {
          type: 'string',
          enum: ['GET', 'POST'],
          description: 'HTTP method (default: GET)',
          default: 'GET',
        },
        params: {
          type: 'object',
          description: 'Query/form parameters for the API call',
          additionalProperties: true,
        },
      },
      required: ['component', 'callType', 'operation'],
    },
  },
];

/* ---------- Domain manifest ---------- */

type HandlerMap = Record<string, (args: ToolArgs) => Promise<unknown>>;
const DEP_KEY = 'zapBridgeHandlers';
const DOMAIN = 'zap-rest-bridge';

function toolByName(name: string): Tool {
  const tool = zapTools.find((item) => item.name === name);
  if (!tool) throw new Error(`Unknown tool in ZAP bridge plugin: ${name}`);
  return tool;
}

function bind(methodName: string) {
  return (deps: ToolHandlerDeps) => async (args: ToolArgs) => {
    const handlers = deps[DEP_KEY] as HandlerMap;
    const method = handlers[methodName];
    if (typeof method !== 'function') {
      throw new Error(`Missing ZAP bridge handler method: ${methodName}`);
    }
    return method(args ?? {});
  };
}

const zapDomain: DomainManifest = {
  kind: 'domain-manifest' as const,
  version: 1 as const,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['workflow', 'full', 'reverse'] as const,
  ensure() {
    const baseUrl = process.env.ZAP_API_URL ?? 'http://127.0.0.1:8080';
    const apiKey = process.env.ZAP_API_KEY;
    return new ZapBridgeHandlers(baseUrl, apiKey);
  },
  registrations: [
    { tool: toolByName('zap_core_version'), domain: DOMAIN, bind: bind('handleZapCoreVersion') },
    { tool: toolByName('zap_api_call'), domain: DOMAIN, bind: bind('handleZapApiCall') },
  ],
};

/* ---------- Plugin contract ---------- */

const plugin: PluginContract = {
  manifest: {
    kind: 'plugin-manifest',
    version: 1,
    id: 'io.github.vmoranv.zap-rest-bridge',
    name: 'OWASP ZAP REST Bridge',
    pluginVersion: '0.1.0',
    entry: 'manifest.js',
    description: 'Extension plugin that exposes ZAP REST API bridge tools.',
    compatibleCore: '>=0.1.0',
    permissions: {
      network: { allowHosts: ['127.0.0.1', 'localhost', '::1'] },
      process: { allowCommands: [] },
      filesystem: { readRoots: [], writeRoots: [] },
      toolExecution: { allowTools: ['zap_core_version', 'zap_api_call'] },
    },
    activation: {
      onStartup: false,
      profiles: ['workflow', 'full', 'reverse'],
    },
    contributes: {
      domains: [zapDomain],
      workflows: [],
      configDefaults: {
        'plugins.zap-rest-bridge.enabled': true,
      },
      metrics: ['zap_rest_bridge_calls_total'],
    },
  },

  onLoad(ctx: PluginLifecycleContext): void {
    ctx.setRuntimeData('loadedAt', new Date().toISOString());
  },

  onValidate(ctx: PluginLifecycleContext) {
    const enabled = getPluginBooleanConfig(ctx, 'zap-rest-bridge', 'enabled', true);
    if (!enabled) {
      return { valid: false, errors: ['Plugin disabled by config'] };
    }
    return { valid: true, errors: [] };
  },

  onRegister(ctx: PluginLifecycleContext): void {
    ctx.registerDomain(zapDomain);
    ctx.registerMetric('zap_rest_bridge_calls_total');
  },
};

export default plugin;
