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
  profiles: ['workflow', 'full'],
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
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
