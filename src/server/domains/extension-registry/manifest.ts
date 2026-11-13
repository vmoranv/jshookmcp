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
      { tool: 'extension_install', method: 'handleInstallTool' },
      { tool: 'extension_list_installed', method: 'handleListInstalledTool' },
      { tool: 'extension_info', method: 'handleInfoTool' },
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

  const handlers = new ExtensionRegistryHandlers(undefined, undefined, ctx.eventBus);
  ctx.setDomainInstance(DEP_KEY, handlers);

  // Start webhook server on demand (lazy)
  void handlers.startWebhookServer().catch(() => undefined);

  return handlers;
}

// ── Document-expansion keywords (search retrieval layer) ──
// Query phrases bridging user vocabulary to this tool's vocabulary without
// duplicating name/description tokens. Folded into generated-tool-catalog by
// scripts/generate-domains-index.mjs; weighted SEARCH_SCENE_KEYWORD_WEIGHT.
const SCENE_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  extension_execute_in_context: [
    'run code inside plugin context',
    'execute in extension scope',
    '插件上下文执行',
  ],
  extension_info: ['plugin details', 'what does this extension do', '插件详情'],
  extension_install: ['install a plugin', 'add extension to registry', '安装插件'],
  extension_list_installed: ['installed plugins list', 'what extensions are loaded', '已装插件'],
  extension_reload: ['reload a plugin', 'refresh extension code', '重载插件'],
  extension_uninstall: ['remove a plugin', 'uninstall extension', '卸载插件'],
  webhook: ['outbound webhook endpoint', 'c2 callback url', 'webhook 端点'],
};

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['full'],
  ensure,
  registrations,

  // Document-expansion keywords for the retrieval layer (SCENE_KEYWORDS above).
  sceneKeywords: SCENE_KEYWORDS,
  workflowRule: {
    patterns: [
      /\b(extension|plugin|addon|webhook|c2|registry)\b/i,
      /(install|uninstall|reload).*(extension|plugin)/i,
    ],
    priority: 70,
    tools: [
      'extension_install',
      'extension_list_installed',
      'extension_info',
      'webhook',
      'extension_execute_in_context',
    ],
    hint: 'Plugin lifecycle (install/info/list/execute/reload/uninstall) + webhook C2 endpoint management.',
  },
  prerequisites: {
    extension_install: [
      {
        condition: 'Local package sources must include package.json or pass an inline manifest',
        fix: 'Pass manifest.{id,name,version,entry} or use a package directory/file with resolvable entry metadata',
      },
    ],
    webhook: [
      {
        condition: 'Webhook listen port must be free',
        fix: 'Pick an unused port via the `port` argument or stop the conflicting service',
      },
    ],
  },
  toolDependencies: [
    { from: 'extension_info', to: 'extension_list_installed', relation: 'suggests', weight: 0.4 },
    { from: 'webhook', to: 'extension_list_installed', relation: 'suggests', weight: 0.5 },
  ],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
