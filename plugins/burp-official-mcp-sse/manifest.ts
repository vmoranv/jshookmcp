/**
 * Burp Official MCP (SSE) bridge plugin.
 *
 * Bridges this server to PortSwigger's official Burp MCP server over SSE.
 * Official upstream: https://github.com/PortSwigger/mcp-server
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainManifest, ToolHandlerDeps, PluginContract, PluginLifecycleContext, ToolArgs } from '../../src/server/plugin-api.js';
import { getPluginBooleanConfig, loadPluginEnv } from '../../src/server/plugin-api.js';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

loadPluginEnv(import.meta.url);

type JsonObject = Record<string, unknown>;
type TextToolResponse = {
  content: Array<{ type: 'text'; text: string }>;
};
type RemoteToolDef = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};
type RemoteListToolsResult = {
  tools?: RemoteToolDef[];
  nextCursor?: string;
};
type RemoteCallResult = {
  content?: Array<{ type?: string; text?: string }>;
};

/* ---------- Utilities ---------- */

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

function assertLoopbackUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid BURP_MCP_SSE_URL: ${value}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Only http/https are allowed, got ${url.protocol}`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  if (!loopback) {
    throw new Error(`Only loopback hosts are allowed (127.0.0.1/localhost/::1), got ${host}`);
  }
  return url.toString();
}

function safeParseToolContent(result: unknown): unknown {
  const maybe = result as RemoteCallResult;
  if (!maybe || !Array.isArray(maybe.content) || maybe.content.length === 0) return result;
  const first = maybe.content[0];
  if (!first || typeof first !== 'object' || typeof first.text !== 'string') return result;
  try {
    return JSON.parse(first.text);
  } catch {
    return first.text;
  }
}

/* ---------- Bridge ---------- */

class BurpOfficialMcpSseBridge {
  sseUrl: string;
  activeUrl: string;
  authToken?: string;
  _client: Client | null;
  _transport: SSEClientTransport | null;
  _connecting: Promise<Client> | null;

  constructor(sseUrl: string, authToken?: string) {
    this.sseUrl = assertLoopbackUrl(sseUrl);
    this.activeUrl = this.sseUrl;
    this.authToken = authToken?.trim() || undefined;
    this._client = null;
    this._transport = null;
    this._connecting = null;
  }

  async _disconnect(): Promise<void> {
    try {
      await this._transport?.close();
    } catch {
      // best effort
    }
    this._client = null;
    this._transport = null;
    this._connecting = null;
  }

  async _connect(force = false): Promise<Client> {
    if (this._client && !force) return this._client;
    if (this._connecting && !force) return this._connecting;

    this._connecting = (async () => {
      if (force) await this._disconnect();

      const requestInit = this.authToken
        ? { headers: { Authorization: `Bearer ${this.authToken}` } }
        : undefined;

      let lastError: unknown = null;
      for (const candidateUrl of this._candidateUrls()) {
        const client = new Client(
          { name: 'jshhook-burp-sse-bridge', version: '0.1.0' },
          { capabilities: {} },
        );
        const transport = new SSEClientTransport(new URL(candidateUrl), { requestInit });
        try {
          await this._withTimeout(
            client.connect(transport),
            5000,
            `connect timeout for ${candidateUrl}`,
          );
          this.activeUrl = candidateUrl;
          this._client = client;
          this._transport = transport;
          return client;
        } catch (error) {
          lastError = error;
          try {
            await transport.close();
          } catch {
            // best effort
          }
        }
      }
      if (lastError instanceof Error) throw lastError;
      throw new Error(lastError ? String(lastError) : 'Unable to establish SSE connection');
    })();

    try {
      return await this._connecting;
    } catch (error) {
      await this._disconnect();
      throw error;
    } finally {
      this._connecting = null;
    }
  }

  async _withReconnect<T>(action: (client: Client) => Promise<T>): Promise<T> {
    const hadClient = Boolean(this._client);
    try {
      const client = await this._connect(false);
      return await action(client);
    } catch {
      if (!hadClient) {
        throw new Error('Unable to reach remote Burp MCP server');
      }
      const client = await this._connect(true);
      return await action(client);
    }
  }

  _candidateUrls(): string[] {
    const primary = new URL(this.activeUrl || this.sseUrl);
    const urls = [primary.toString()];

    const hasSseSuffix = primary.pathname.endsWith('/sse');
    if (hasSseSuffix) {
      const fallback = new URL(primary.toString());
      fallback.pathname = fallback.pathname.replace(/\/sse$/, '') || '/';
      urls.push(fallback.toString());
    } else {
      const fallback = new URL(primary.toString());
      fallback.pathname = `${fallback.pathname.replace(/\/$/, '')}/sse`;
      urls.push(fallback.toString());
    }

    return [...new Set(urls)];
  }

  async _withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    timeoutMessage: string,
  ): Promise<T> {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        setTimeout(() => reject(new Error(timeoutMessage)), ms);
      }),
    ]);
  }

  async handleStatus(_args: ToolArgs = {}): Promise<TextToolResponse> {
    try {
      const data = await this._withReconnect(async (client) => {
        const listed = (await this._withTimeout(
          client.listTools(),
          8000,
          'tools/list timeout from remote Burp MCP server',
        )) as RemoteListToolsResult;
        const tools = Array.isArray(listed?.tools) ? listed.tools : [];
        return {
          toolCount: tools.length,
          toolNames: tools.map((t: RemoteToolDef) => t.name),
          serverVersion: client.getServerVersion(),
          serverCapabilities: client.getServerCapabilities(),
        };
      });

      return toText({
        success: true,
        endpoint: this.activeUrl,
        transport: 'sse',
        ...data,
      });
    } catch (error) {
      return toErr('burp_mcp_sse_status', error, {
        endpoint: this.sseUrl,
        hint:
          'Ensure PortSwigger MCP server is running (default http://127.0.0.1:9876 or /sse) and BURP_MCP_SSE_URL is correct.',
      });
    }
  }

  async handleListTools(args: ToolArgs = {}): Promise<TextToolResponse> {
    try {
      const cursor = typeof args.cursor === 'string' ? args.cursor : undefined;
      const listed = (await this._withReconnect((client) =>
        this._withTimeout(
          client.listTools({ cursor }),
          8000,
          'tools/list timeout from remote Burp MCP server',
        ),
      )) as RemoteListToolsResult;
      const tools = Array.isArray(listed?.tools) ? listed.tools : [];
      return toText({
        success: true,
        endpoint: this.activeUrl,
        count: tools.length,
        nextCursor: listed?.nextCursor,
        tools: tools.map((tool: RemoteToolDef) => ({
          name: tool.name,
          description: tool.description ?? '',
          inputSchema: tool.inputSchema ?? null,
        })),
      });
    } catch (error) {
      return toErr('burp_mcp_sse_list_tools', error, { endpoint: this.activeUrl });
    }
  }

  async handleCallTool(args: ToolArgs = {}): Promise<TextToolResponse> {
    const name = typeof args.name === 'string' ? args.name : '';
    if (!name) {
      return toErr('burp_mcp_sse_call_tool', new Error('name is required'));
    }

    const rawArguments = args.arguments;
    const toolArgs =
      rawArguments &&
      typeof rawArguments === 'object' &&
      !Array.isArray(rawArguments)
        ? (rawArguments as Record<string, unknown>)
        : {};

    try {
      const result = (await this._withReconnect((client) =>
        this._withTimeout(
          client.callTool({
            name,
            arguments: toolArgs,
          }),
          12000,
          `tools/call timeout for remote tool ${name}`,
        ),
      )) as RemoteCallResult;

      return toText({
        success: true,
        endpoint: this.activeUrl,
        forwardedTool: name,
        result: safeParseToolContent(result),
      });
    } catch (error) {
      return toErr('burp_mcp_sse_call_tool', error, {
        endpoint: this.activeUrl,
        forwardedTool: name,
      });
    }
  }
}

/* ---------- Tool defs ---------- */

const tools: Tool[] = [
  {
    name: 'burp_mcp_sse_status',
    description:
      'Check connectivity to PortSwigger official Burp MCP server over SSE and return remote tool catalog summary.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'burp_mcp_sse_list_tools',
    description:
      'List tools exposed by the remote PortSwigger Burp MCP server (SSE transport).',
    inputSchema: {
      type: 'object',
      properties: {
        cursor: {
          type: 'string',
          description: 'Optional pagination cursor forwarded to remote MCP tools/list',
        },
      },
    },
  },
  {
    name: 'burp_mcp_sse_call_tool',
    description:
      'Call any remote tool exposed by PortSwigger Burp MCP server over SSE.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Remote Burp MCP tool name',
        },
        arguments: {
          type: 'object',
          description: 'Arguments object forwarded to the remote tool',
          additionalProperties: true,
        },
      },
      required: ['name'],
    },
  },
];

/* ---------- Domain ---------- */

type HandlerMap = Record<string, (args: ToolArgs) => Promise<unknown>>;
const DEP_KEY = 'burpOfficialMcpSseBridge';
const DOMAIN = 'burp-official-mcp-sse';

function toolByName(name: string): Tool {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return tool;
}

function bind(methodName: string) {
  return (deps: ToolHandlerDeps) => async (args: ToolArgs) => {
    const bridge = deps[DEP_KEY] as HandlerMap;
    const method = bridge[methodName];
    if (typeof method !== 'function') {
      throw new Error(`Missing Burp SSE bridge handler method: ${methodName}`);
    }
    return method(args ?? {});
  };
}

const domainManifest: DomainManifest = {
  kind: 'domain-manifest' as const,
  version: 1 as const,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['workflow', 'full', 'reverse'] as const,
  ensure() {
    const sseUrl = process.env.BURP_MCP_SSE_URL ?? 'http://127.0.0.1:9876/sse';
    const authToken = process.env.BURP_MCP_AUTH_TOKEN;
    return new BurpOfficialMcpSseBridge(sseUrl, authToken);
  },
  registrations: [
    {
      tool: toolByName('burp_mcp_sse_status'),
      domain: DOMAIN,
      bind: bind('handleStatus'),
    },
    {
      tool: toolByName('burp_mcp_sse_list_tools'),
      domain: DOMAIN,
      bind: bind('handleListTools'),
    },
    {
      tool: toolByName('burp_mcp_sse_call_tool'),
      domain: DOMAIN,
      bind: bind('handleCallTool'),
    },
  ],
};

/* ---------- Plugin contract ---------- */

const plugin: PluginContract = {
  manifest: {
    kind: 'plugin-manifest',
    version: 1,
    id: 'io.github.vmoranv.burp-official-mcp-sse',
    name: 'Burp Official MCP SSE Bridge',
    pluginVersion: '0.1.0',
    entry: 'manifest.js',
    description:
      'Bridge to PortSwigger official Burp MCP server over SSE transport.',
    compatibleCore: '>=0.1.0',
    permissions: {
      network: { allowHosts: ['127.0.0.1', 'localhost', '::1'] },
      process: { allowCommands: [] },
      filesystem: { readRoots: [], writeRoots: [] },
      toolExecution: {
        allowTools: [
          'burp_mcp_sse_status',
          'burp_mcp_sse_list_tools',
          'burp_mcp_sse_call_tool',
        ],
      },
    },
    activation: {
      onStartup: false,
      profiles: ['workflow', 'full', 'reverse'],
    },
    contributes: {
      domains: [domainManifest],
      workflows: [],
      configDefaults: {
        'plugins.burp-official-mcp-sse.enabled': true,
      },
      metrics: ['burp_official_mcp_sse_calls_total'],
    },
  },

  onLoad(ctx: PluginLifecycleContext): void {
    ctx.setRuntimeData('loadedAt', new Date().toISOString());
  },

  onValidate(ctx: PluginLifecycleContext) {
    const enabled = getPluginBooleanConfig(ctx, 'burp-official-mcp-sse', 'enabled', true);
    if (!enabled) {
      return { valid: false, errors: ['Plugin disabled by config'] };
    }
    return { valid: true, errors: [] };
  },

  onRegister(ctx: PluginLifecycleContext): void {
    ctx.registerDomain(domainManifest);
    ctx.registerMetric('burp_official_mcp_sse_calls_total');
  },
};

export default plugin;
