import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, toolLookup } from '@server/domains/shared/registry';
import { extensionRegistryTools } from './definitions';
import { ExtensionRegistryHandlers } from './handlers';

const DOMAIN = 'extension-registry';
const DEP_KEY = 'extensionRegistryHandlers';
type H = ExtensionRegistryHandlers;
const t = toolLookup(extensionRegistryTools);
const b = (invoke: (handlers: H, args: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);

function ensure(ctx: MCPServerContext): H {
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
  registrations: [
    {
      tool: t('extension_list_installed'),
      domain: DOMAIN,
      bind: b((handlers) => handlers.handleListInstalled()),
    },
    {
      tool: t('extension_execute_in_context'),
      domain: DOMAIN,
      bind: b((handlers, args) => handlers.handleExecuteInContext(args)),
    },
    {
      tool: t('extension_install'),
      domain: DOMAIN,
      bind: b((handlers, args) => handlers.handleInstall(args)),
    },
    {
      tool: t('extension_reload'),
      domain: DOMAIN,
      bind: b((handlers, args) => handlers.handleReload(args)),
    },
    {
      tool: t('extension_uninstall'),
      domain: DOMAIN,
      bind: b((handlers, args) => handlers.handleUninstall(args)),
    },
    {
      tool: t('webhook_create'),
      domain: DOMAIN,
      bind: b((handlers, args) => handlers.handleWebhookCreate(args)),
    },
    {
      tool: t('webhook_list'),
      domain: DOMAIN,
      bind: b((handlers) => handlers.handleWebhookList()),
    },
    {
      tool: t('webhook_delete'),
      domain: DOMAIN,
      bind: b((handlers, args) => handlers.handleWebhookDelete(args)),
    },
    {
      tool: t('webhook_commands'),
      domain: DOMAIN,
      bind: b((handlers, args) => handlers.handleWebhookCommands(args)),
    },
  ],
  workflowRule: {
    patterns: [
      /\b(extension|plugin|addon|webhook|c2|bluetooth|ble|hid|serial|esp32|registry)\b/i,
      /(install|uninstall|reload).*(extension|plugin)/i,
    ],
    priority: 70,
    tools: ['extension_install', 'extension_list_installed', 'webhook_create', 'webhook_commands'],
    hint: 'Plugin + webhook C2 + BLE HID + serial flashing pipeline.',
  },
  prerequisites: {
    extension_install: [
      {
        condition: 'EXTENSION_REGISTRY_BASE_URL must be configured for registry installs',
        fix: 'Set EXTENSION_REGISTRY_BASE_URL env or pass a direct git URL / file path',
      },
    ],
    webhook_create: [
      {
        condition: 'Webhook listen port must be free',
        fix: 'Pick an unused port via the `port` argument or stop the conflicting service',
      },
    ],
  },
  toolDependencies: [
    {
      from: 'extension_install',
      to: 'extension_list_installed',
      relation: 'suggests',
      weight: 0.5,
    },
    { from: 'webhook_create', to: 'webhook_list', relation: 'suggests', weight: 0.5 },
    { from: 'webhook_commands', to: 'webhook_list', relation: 'precedes', weight: 0.3 },
  ],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
