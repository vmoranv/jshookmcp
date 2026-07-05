import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { defineMethodRegistrations, toolLookup } from '@server/domains/shared/registry';
import { extensionRegistryTools } from './definitions';
import type { ExtensionRegistryHandlers } from './handlers';

const DOMAIN = 'extension-registry';
const DEP_KEY = 'extensionRegistryHandlers';
type H = ExtensionRegistryHandlers;
const t = toolLookup(extensionRegistryTools);
const registrations = defineMethodRegistrations<H, (typeof extensionRegistryTools)[number]['name']>(
  {
    domain: DOMAIN,
    depKey: DEP_KEY,
    lookup: t,
    entries: [
      { tool: 'extension_list_installed', method: 'handleListInstalledTool' },
      { tool: 'extension_execute_in_context', method: 'handleExecuteInContextTool' },
      { tool: 'extension_reload', method: 'handleReloadTool' },
      { tool: 'extension_uninstall', method: 'handleUninstallTool' },
      { tool: 'webhook', method: 'handleWebhookDispatchTool' },
    ],
  },
);

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { ExtensionRegistryHandlers } = await import('./handlers');
  const existing = ctx.getDomainInstance<H>(DEP_KEY);
  if (existing) {
    return existing;
  }

  const handlers = new ExtensionRegistryHandlers();
  ctx.setDomainInstance(DEP_KEY, handlers);

  // Start webhook server on demand (lazy)
  void handlers.startWebhookServer().catch(() => undefined);

  return handlers;
}

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['full'],
  ensure,
  registrations,
  workflowRule: {
    patterns: [
      /\b(extension|plugin|addon|webhook|c2|registry)\b/i,
      /(install|uninstall|reload).*(extension|plugin)/i,
    ],
    priority: 70,
    tools: ['extension_list_installed', 'webhook', 'extension_execute_in_context'],
    hint: 'Plugin lifecycle (list/execute/reload/uninstall) + webhook C2 endpoint management.',
  },
  prerequisites: {
    webhook: [
      {
        condition: 'Webhook listen port must be free',
        fix: 'Pick an unused port via the `port` argument or stop the conflicting service',
      },
    ],
  },
  toolDependencies: [
    { from: 'webhook', to: 'extension_list_installed', relation: 'suggests', weight: 0.5 },
  ],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
