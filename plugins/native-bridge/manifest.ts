/**
 * Native RE bridge plugin.
 *
 * Moves native reverse-engineering bridge tools out of built-in domains:
 * - native_bridge_status
 * - ghidra_bridge
 * - ida_bridge
 * - native_symbol_sync
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainManifest, ToolHandlerDeps, PluginContract, PluginLifecycleContext, ToolArgs } from '../../src/server/plugin-api.js';
import { getPluginBooleanConfig, loadPluginEnv } from '../../src/server/plugin-api.js';

loadPluginEnv(import.meta.url);

type HandlerMethod = (args: ToolArgs) => Promise<unknown>;
type HandlerMap = Record<string, HandlerMethod>;
type NativeBridgeHandlersCtor = new (
  ghidraEndpoint: string,
  idaEndpoint: string,
) => HandlerMap;

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

const defsModule = await importFromCandidates([
  '../../dist/server/domains/native-bridge/definitions.js',
  '../../src/server/domains/native-bridge/definitions.ts',
]);

const handlersModule = await importFromCandidates([
  '../../dist/server/domains/native-bridge/index.js',
  '../../src/server/domains/native-bridge/index.ts',
]);

const nativeBridgeTools = defsModule.nativeBridgeTools as Tool[];
const NativeBridgeHandlers = handlersModule.NativeBridgeHandlers as NativeBridgeHandlersCtor;

if (!Array.isArray(nativeBridgeTools)) {
  throw new Error('nativeBridgeTools export missing from native-bridge definitions module');
}
if (typeof NativeBridgeHandlers !== 'function') {
  throw new Error('NativeBridgeHandlers export missing from native-bridge handler module');
}

function toolByName(name: string): Tool {
  const tool = nativeBridgeTools.find((item) => item?.name === name);
  if (!tool) throw new Error(`Unknown tool in native bridge plugin: ${name}`);
  return tool;
}

const DEP_KEY = 'nativeBridgeHandlers';
const DOMAIN = 'native-bridge';

function bind(methodName: string) {
  return (deps: ToolHandlerDeps) => async (args: ToolArgs) => {
    const handlers = deps[DEP_KEY] as HandlerMap;
    const method = handlers[methodName];
    if (typeof method !== 'function') {
      throw new Error(`Missing native bridge handler method: ${methodName}`);
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
    const ghidraEndpoint = process.env.GHIDRA_BRIDGE_URL ?? 'http://127.0.0.1:18080';
    const idaEndpoint = process.env.IDA_BRIDGE_URL ?? 'http://127.0.0.1:18081';
    return new NativeBridgeHandlers(ghidraEndpoint, idaEndpoint);
  },
  registrations: [
    { tool: toolByName('native_bridge_status'), domain: DOMAIN, bind: bind('handleNativeBridgeStatus') },
    { tool: toolByName('ghidra_bridge'), domain: DOMAIN, bind: bind('handleGhidraBridge') },
    { tool: toolByName('ida_bridge'), domain: DOMAIN, bind: bind('handleIdaBridge') },
    { tool: toolByName('native_symbol_sync'), domain: DOMAIN, bind: bind('handleNativeSymbolSync') },
  ],
};

const plugin: PluginContract = {
  manifest: {
    kind: 'plugin-manifest',
    version: 1,
    id: 'io.github.vmoranv.native-bridge',
    name: 'Native RE Bridge',
    pluginVersion: '0.1.0',
    entry: 'manifest.js',
    description: 'Externalized native reverse-engineering bridge tools (Ghidra/IDA).',
    compatibleCore: '>=0.1.0',
    permissions: {
      network: { allowHosts: ['127.0.0.1', 'localhost', '::1'] },
      process: { allowCommands: [] },
      filesystem: { readRoots: [], writeRoots: [] },
      toolExecution: {
        allowTools: ['native_bridge_status', 'ghidra_bridge', 'ida_bridge', 'native_symbol_sync'],
      },
    },
    activation: {
      onStartup: false,
      profiles: ['full', 'reverse'],
    },
    contributes: {
      domains: [domainManifest],
      workflows: [],
      configDefaults: {
        'plugins.native-bridge.enabled': true,
      },
      metrics: ['native_bridge_calls_total'],
    },
  },

  onLoad(ctx: PluginLifecycleContext): void {
    ctx.setRuntimeData('loadedAt', new Date().toISOString());
  },

  onValidate(ctx: PluginLifecycleContext) {
    const enabled = getPluginBooleanConfig(ctx, 'native-bridge', 'enabled', true);
    if (!enabled) {
      return { valid: false, errors: ['Plugin disabled by config'] };
    }
    return { valid: true, errors: [] };
  },

  onRegister(ctx: PluginLifecycleContext): void {
    ctx.registerDomain(domainManifest);
    ctx.registerMetric('native_bridge_calls_total');
  },
};

export default plugin;
