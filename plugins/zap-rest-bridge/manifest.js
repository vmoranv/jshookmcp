/**
 * OWASP ZAP REST API bridge plugin.
 *
 * Default endpoint: http://127.0.0.1:8080
 * Docs: https://www.zaproxy.org/docs/api/
 */

/* ---------- Utilities ---------- */

function isLoopbackUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const host = url.hostname.replace(/^\[|\]$/g, '');
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch {
    return false;
  }
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  return `${url.protocol}//${url.host}`;
}

function toText(payload) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

function toErr(tool, error, extra = {}) {
  return toText({
    success: false,
    tool,
    error: error instanceof Error ? error.message : String(error),
    ...extra,
  });
}

function buildZapUrl(baseUrl, path, query = {}) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${baseUrl.replace(/\/$/, '')}${normalizedPath}`);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function requestJson(url, method = 'GET', bodyObj = undefined) {
  const body = bodyObj ? new URLSearchParams(bodyObj).toString() : undefined;
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
  let data = {};
  if (text.length > 0) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { text };
    }
  }
  return { status: res.status, data };
}

/* ---------- Handlers ---------- */

class ZapBridgeHandlers {
  constructor(baseUrl = 'http://127.0.0.1:8080', apiKey = undefined) {
    if (!isLoopbackUrl(baseUrl)) {
      throw new Error(
        `ZAP bridge only allows loopback addresses (127.0.0.1/localhost/::1), got "${baseUrl}"`,
      );
    }
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.apiKey = apiKey?.trim() || undefined;
  }

  async handleZapCoreVersion(_args) {
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

  async handleZapApiCall(args) {
    const format = (args.format || 'JSON').toString().toUpperCase();
    const component = (args.component || '').toString();
    const callType = (args.callType || 'view').toString();
    const operation = (args.operation || '').toString();
    const method = (args.method || 'GET').toString().toUpperCase();
    const params = (args.params && typeof args.params === 'object') ? args.params : {};

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

const zapTools = [
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

const DEP_KEY = 'zapBridgeHandlers';

function bind(methodName) {
  return (deps) => async (args) => {
    const handlers = deps[DEP_KEY];
    return handlers[methodName](args ?? {});
  };
}

const zapDomain = {
  kind: 'domain-manifest',
  version: 1,
  domain: 'zap-rest-bridge',
  depKey: DEP_KEY,
  profiles: ['workflow', 'full', 'reverse'],
  ensure() {
    const baseUrl = process.env.ZAP_API_URL ?? 'http://127.0.0.1:8080';
    const apiKey = process.env.ZAP_API_KEY;
    return new ZapBridgeHandlers(baseUrl, apiKey);
  },
  registrations: [
    { tool: zapTools[0], domain: 'zap-rest-bridge', bind: bind('handleZapCoreVersion') },
    { tool: zapTools[1], domain: 'zap-rest-bridge', bind: bind('handleZapApiCall') },
  ],
};

/* ---------- Plugin contract ---------- */

const plugin = {
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

  onLoad(ctx) {
    ctx.setRuntimeData('loadedAt', new Date().toISOString());
  },

  onValidate(ctx) {
    const enabled = ctx.getConfig('plugins.zap-rest-bridge.enabled', true);
    if (!enabled) {
      return { valid: false, errors: ['Plugin disabled by config'] };
    }
    return { valid: true, errors: [] };
  },

  onRegister(ctx) {
    ctx.registerDomain(zapDomain);
    ctx.registerMetric('zap_rest_bridge_calls_total');
  },
};

export default plugin;
