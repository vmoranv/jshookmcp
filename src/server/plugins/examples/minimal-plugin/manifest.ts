/**
 * Minimal example plugin for jshookmcp.
 *
 * Demonstrates the PluginContract lifecycle by contributing a simple
 * 'example-hello' domain with a single 'plugin_hello' tool.
 *
 * Usage:
 *   1. Place this directory under a configured plugin root
 *   2. The PluginLoader discovers and validates it
 *   3. On activation, 'plugin_hello' becomes available via search_tools/activate_tools
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainManifest } from '../../../registry/contracts.js';
import type {
  PluginContract,
  PluginLifecycleContext,
  PluginValidationResult,
} from '../../PluginContract.js';

/* ---------- Handler type ---------- */

type ExampleHelloHandlers = {
  handleHello(args: Record<string, unknown>): Promise<unknown>;
};

/* ---------- Tool definition ---------- */

const helloTool: Tool = {
  name: 'plugin_hello',
  description:
    'Minimal example plugin tool. Returns a greeting message.\n\n' +
    'This tool demonstrates the plugin system — it is contributed by the ' +
    '"example.minimal-hello" plugin and only available when that plugin is activated.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name to greet (default: "world")',
      },
    },
  },
};

/* ---------- Domain manifest ---------- */

function bindHello(depKey: string) {
  return (deps: Record<string, unknown>) =>
    async (args: Record<string, unknown>) => {
      const handlers = deps[depKey] as ExampleHelloHandlers;
      return handlers.handleHello(args);
    };
}

const exampleDomain: DomainManifest<
  'exampleHelloHandlers',
  ExampleHelloHandlers,
  'example-hello'
> = {
  kind: 'domain-manifest',
  version: 1,
  domain: 'example-hello',
  depKey: 'exampleHelloHandlers',
  profiles: ['workflow', 'full'],
  ensure() {
    return {
      async handleHello(args) {
        const name = (args.name as string) || 'world';
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `Hello, ${name}! This response comes from the minimal example plugin.`,
                timestamp: new Date().toISOString(),
              }),
            },
          ],
        };
      },
    };
  },
  registrations: [
    {
      tool: helloTool,
      domain: 'example-hello',
      bind: bindHello('exampleHelloHandlers'),
    },
  ],
};

/* ---------- Plugin contract ---------- */

function validateConfig(ctx: PluginLifecycleContext): PluginValidationResult {
  const enabled = ctx.getConfig<boolean>('plugins.example-hello.enabled', true);
  if (!enabled) {
    return { valid: false, errors: ['Plugin disabled by config'] };
  }
  return { valid: true, errors: [] };
}

const plugin: PluginContract = {
  manifest: {
    kind: 'plugin-manifest',
    version: 1,
    id: 'example.minimal-hello',
    name: 'Minimal Hello Plugin',
    pluginVersion: '0.1.0',
    entry: 'manifest.ts',
    description: 'A minimal example plugin that contributes a single greeting tool.',
    compatibleCore: '>=0.1.0',
    permissions: {
      network: { allowHosts: [] },
      process: { allowCommands: [] },
      filesystem: { readRoots: [], writeRoots: [] },
      toolExecution: { allowTools: ['plugin_hello'] },
    },
    activation: {
      onStartup: false,
      profiles: ['workflow', 'full'],
    },
    contributes: {
      domains: [exampleDomain],
      workflows: [],
      configDefaults: {
        'plugins.example-hello.enabled': true,
      },
      metrics: ['plugin_hello_calls_total'],
    },
  },

  onLoad(ctx) {
    ctx.setRuntimeData('loadedAt', new Date().toISOString());
  },

  onValidate(ctx) {
    return validateConfig(ctx);
  },

  onRegister(ctx) {
    ctx.registerDomain(exampleDomain);
    ctx.registerMetric('plugin_hello_calls_total');
  },
};

export default plugin;
