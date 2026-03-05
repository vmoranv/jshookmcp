/**
 * Platform bridge plugin.
 *
 * Moves platform bridge tools out of built-in platform domain:
 * - frida_bridge
 * - jadx_bridge
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainManifest, ToolHandlerDeps, PluginContract, PluginLifecycleContext, ToolArgs } from '../../src/server/plugin-api.js';
import { getPluginBooleanConfig, loadPluginEnv } from '../../src/server/plugin-api.js';

loadPluginEnv(import.meta.url);

type HandlerMethod = (args: ToolArgs) => Promise<unknown>;
type HandlerMap = Record<string, HandlerMethod>;
type BridgeHandlersCtor = new (runner: unknown) => HandlerMap;
type ExternalToolRunnerCtor = new (registry: unknown) => unknown;
type ToolRegistryCtor = new () => unknown;

async function importFromCandidates(
  candidates: readonly string[],
): Promise<Record<string, unknown>> {
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      return (await import(new URL(candidate, import.meta.url).href)) as Record<string, unknown>;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('No import candidates available');
}

const bridgeHandlersModule = await importFromCandidates([
  '../../dist/server/domains/platform/handlers/bridge-handlers.js',
  '../../src/server/domains/platform/handlers/bridge-handlers.ts',
]);

const externalRunnerModule = await importFromCandidates([
  '../../dist/modules/external/ExternalToolRunner.js',
  '../../src/modules/external/ExternalToolRunner.ts',
]);

const toolRegistryModule = await importFromCandidates([
  '../../dist/modules/external/ToolRegistry.js',
  '../../src/modules/external/ToolRegistry.ts',
]);

const BridgeHandlers = bridgeHandlersModule.BridgeHandlers as BridgeHandlersCtor;
const ExternalToolRunner = externalRunnerModule.ExternalToolRunner as ExternalToolRunnerCtor;
const ToolRegistry = toolRegistryModule.ToolRegistry as ToolRegistryCtor;

if (typeof BridgeHandlers !== 'function') {
  throw new Error('BridgeHandlers export missing for platform bridge plugin');
}
if (typeof ExternalToolRunner !== 'function' || typeof ToolRegistry !== 'function') {
  throw new Error('External tool classes missing for platform bridge plugin');
}

const platformBridgeTools: Tool[] = [
  {
    name: 'frida_bridge',
    description:
      'Frida integration bridge tool. Check local Frida environment, generate script templates, and return collaboration guidance with this MCP server. Requires external frida-tools.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['check_env', 'generate_script', 'guide'],
          description: 'check_env, generate_script, or guide',
        },
        target: {
          type: 'string',
          description: 'Target process name or PID (used by generate_script).',
        },
        hookType: {
          type: 'string',
          enum: ['intercept', 'replace', 'stalker', 'module_export'],
          description: 'Hook template type (default: intercept).',
          default: 'intercept',
        },
        functionName: {
          type: 'string',
          description: 'Function or symbol to hook (used by generate_script).',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'jadx_bridge',
    description:
      'Jadx integration bridge tool. Check local jadx environment, decompile APK/DEX/AAR, and return usage guidance. Requires external jadx CLI.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['check_env', 'decompile', 'guide'],
          description: 'check_env, decompile, or guide',
        },
        inputPath: {
          type: 'string',
          description: 'Path to APK/DEX/AAR file (required for decompile).',
        },
        outputDir: {
          type: 'string',
          description: 'Optional output directory for decompilation result.',
        },
        extraArgs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Additional jadx CLI arguments.',
        },
      },
      required: ['action'],
    },
  },
];

function toolByName(name: string): Tool {
  const tool = platformBridgeTools.find((item) => item?.name === name);
  if (!tool) throw new Error(`Unknown tool in platform bridge plugin: ${name}`);
  return tool;
}

const DEP_KEY = 'platformBridgeHandlers';
const DOMAIN = 'platform-bridge';

function bind(methodName: string) {
  return (deps: ToolHandlerDeps) => async (args: ToolArgs) => {
    const handlers = deps[DEP_KEY] as HandlerMap;
    const method = handlers[methodName];
    if (typeof method !== 'function') {
      throw new Error(`Missing platform bridge handler method: ${methodName}`);
    }
    return method(args ?? {});
  };
}

const domainManifest: DomainManifest = {
  kind: 'domain-manifest' as const,
  version: 1 as const,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['full', 'reverse'] as const,
  ensure() {
    const registry = new ToolRegistry();
    const runner = new ExternalToolRunner(registry);
    return new BridgeHandlers(runner);
  },
  registrations: [
    { tool: toolByName('frida_bridge'), domain: DOMAIN, bind: bind('handleFridaBridge') },
    { tool: toolByName('jadx_bridge'), domain: DOMAIN, bind: bind('handleJadxBridge') },
  ],
};

const plugin: PluginContract = {
  manifest: {
    kind: 'plugin-manifest',
    version: 1,
    id: 'io.github.vmoranv.platform-bridge',
    name: 'Platform Bridge',
    pluginVersion: '0.1.0',
    entry: 'manifest.js',
    description: 'Externalized platform bridge tools (Frida/Jadx).',
    compatibleCore: '>=0.1.0',
    permissions: {
      network: { allowHosts: ['127.0.0.1', 'localhost', '::1'] },
      process: { allowCommands: [] },
      filesystem: { readRoots: [], writeRoots: [] },
      toolExecution: { allowTools: ['frida_bridge', 'jadx_bridge'] },
    },
    activation: {
      onStartup: false,
      profiles: ['full', 'reverse'],
    },
    contributes: {
      domains: [domainManifest],
      workflows: [],
      configDefaults: {
        'plugins.platform-bridge.enabled': true,
      },
      metrics: ['platform_bridge_calls_total'],
    },
  },

  onLoad(ctx: PluginLifecycleContext): void {
    ctx.setRuntimeData('loadedAt', new Date().toISOString());
  },

  onValidate(ctx: PluginLifecycleContext) {
    const enabled = getPluginBooleanConfig(ctx, 'platform-bridge', 'enabled', true);
    if (!enabled) {
      return { valid: false, errors: ['Plugin disabled by config'] };
    }
    return { valid: true, errors: [] };
  },

  onRegister(ctx: PluginLifecycleContext): void {
    ctx.registerDomain(domainManifest);
    ctx.registerMetric('platform_bridge_calls_total');
  },
};

export default plugin;
