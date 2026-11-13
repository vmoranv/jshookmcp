import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { defineMethodRegistrations, toolLookup } from '@server/domains/shared/registry';
import type { ArtifactCategory } from '@utils/artifacts';
import {
  tokenBudgetTools,
  cacheTools,
  extensionTools,
  artifactTools,
  sandboxTools,
  snapshotTools,
} from '@server/domains/maintenance/definitions';
import type {
  CoreMaintenanceHandlers,
  ExtensionManagementHandlers,
  SandboxToolHandlers,
} from '@server/domains/maintenance/index';

const DOMAIN = 'maintenance' as const;
const DEP_KEY = 'coreMaintenanceHandlers' as const;
const EXT_DEP_KEY = 'extensionManagementHandlers' as const;
const SANDBOX_DEP_KEY = 'sandboxHandlers' as const;
type H = CoreMaintenanceHandlers;
type E = ExtensionManagementHandlers;
type S = SandboxToolHandlers;
const coreToolDefinitions = [
  ...tokenBudgetTools,
  ...cacheTools,
  ...artifactTools,
  ...snapshotTools,
] as const;
const extensionToolDefinitions = [...extensionTools] as const;
const sandboxToolDefinitions = [...sandboxTools] as const;
const t = toolLookup([
  ...coreToolDefinitions,
  ...extensionToolDefinitions,
  ...sandboxToolDefinitions,
]);
const coreRegistrations = defineMethodRegistrations<
  H,
  (typeof coreToolDefinitions)[number]['name']
>({
  domain: DOMAIN,
  depKey: DEP_KEY,
  lookup: t,
  entries: [
    {
      tool: 'get_token_budget_stats',
      method: 'handleGetTokenBudgetStats',
      profiles: ['workflow', 'full'],
    },
    { tool: 'manual_token_cleanup', method: 'handleManualTokenCleanup' },
    { tool: 'reset_token_budget', method: 'handleResetTokenBudget' },
    {
      tool: 'get_cache_stats',
      method: 'handleGetCacheStats',
      profiles: ['workflow', 'full'],
    },
    {
      tool: 'smart_cache_cleanup',
      method: 'handleSmartCacheCleanup',
      mapArgs: (args) => [
        args.targetSize as number | undefined,
        args.namespaces as readonly string[] | undefined,
      ],
    },
    { tool: 'clear_all_caches', method: 'handleClearAllCaches' },
    {
      tool: 'cleanup_artifacts',
      method: 'handleCleanupArtifacts',
      mapArgs: (args) => [
        {
          retentionDays: args.retentionDays as number | undefined,
          maxTotalBytes: args.maxTotalBytes as number | undefined,
          dryRun: args.dryRun as boolean | undefined,
          categories: args.categories as ArtifactCategory[] | undefined,
          excludeCategories: args.excludeCategories as ArtifactCategory[] | undefined,
        },
      ],
    },
    {
      tool: 'doctor_environment',
      method: 'handleEnvironmentDoctor',
      mapArgs: (args) => [
        {
          includeBridgeHealth: args.includeBridgeHealth as boolean | undefined,
        },
      ],
    },
    {
      tool: 'maintenance_detect_gpu',
      method: 'handleDetectGpu',
      profiles: ['workflow', 'full'],
    },
    {
      tool: 'snapshot_create',
      method: 'handleSnapshotCreate',
      mapArgs: (args) => [
        {
          targetDir: args.targetDir as unknown,
          label: args.label as unknown,
        },
      ],
    },
    {
      tool: 'snapshot_list',
      method: 'handleSnapshotList',
      mapArgs: (args) => [{ targetDir: args.targetDir as unknown }],
    },
    {
      tool: 'snapshot_restore',
      method: 'handleSnapshotRestore',
      mapArgs: (args) => [
        {
          targetDir: args.targetDir as unknown,
          snapshotId: args.snapshotId as unknown,
        },
      ],
    },
  ],
});
const extensionRegistrations = defineMethodRegistrations<
  E,
  (typeof extensionToolDefinitions)[number]['name']
>({
  domain: DOMAIN,
  depKey: EXT_DEP_KEY,
  lookup: t,
  entries: [
    {
      tool: 'list_extensions',
      method: 'handleListExtensions',
      profiles: ['workflow', 'full'],
      mapArgs: (args) => [{ includeIntegrity: args.includeIntegrity as boolean | undefined }],
    },
    { tool: 'reload_extensions', method: 'handleReloadExtensions' },
    {
      tool: 'browse_extension_registry',
      method: 'handleBrowseExtensionRegistry',
      profiles: ['workflow', 'full'],
      mapArgs: (args) => [(args.kind as string) ?? 'all'],
    },
    {
      tool: 'install_extension',
      method: 'handleInstallExtension',
      mapArgs: (args) => [args.slug as string, args.targetDir as string | undefined],
    },
  ],
});

const sandboxRegistrations = defineMethodRegistrations<
  S,
  (typeof sandboxToolDefinitions)[number]['name']
>({
  domain: DOMAIN,
  depKey: SANDBOX_DEP_KEY,
  lookup: t,
  entries: [
    {
      tool: 'execute_sandbox_script',
      method: 'handleExecuteSandboxScript',
      profiles: ['full'],
    },
  ],
});

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { CoreMaintenanceHandlers, ExtensionManagementHandlers, SandboxToolHandlers } =
    await import('@server/domains/maintenance/index');
  if (!ctx.coreMaintenanceHandlers || !ctx.extensionManagementHandlers || !ctx.sandboxHandlers) {
    if (!ctx.coreMaintenanceHandlers) {
      ctx.coreMaintenanceHandlers = new CoreMaintenanceHandlers({
        tokenBudget: ctx.tokenBudget,
        unifiedCache: ctx.unifiedCache,
      });
    }
    if (!ctx.extensionManagementHandlers) {
      ctx.extensionManagementHandlers = new ExtensionManagementHandlers(ctx);
    }
    if (!ctx.sandboxHandlers) {
      ctx.sandboxHandlers = new SandboxToolHandlers(ctx);
    }
  }
  return ctx.coreMaintenanceHandlers;
}

// ── Document-expansion keywords (search retrieval layer) ──
// Query phrases bridging user vocabulary to this tool's vocabulary without
// duplicating name/description tokens. Folded into generated-tool-catalog by
// scripts/generate-domains-index.mjs; weighted SEARCH_SCENE_KEYWORD_WEIGHT.
const SCENE_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  browse_extension_registry: [
    'browse the plugin marketplace',
    'list registry entries',
    '浏览插件仓库',
  ],
  cleanup_artifacts: ['delete old artifacts', 'clean the output directory', '清理产物'],
  clear_all_caches: ['flush every cache', 'wipe cached data', '清空缓存'],
  doctor_environment: ['diagnose my setup', 'what is broken in this environment', '环境诊断'],
  execute_sandbox_script: ['run code in the sandbox', 'safe script execution', '沙箱执行'],
  get_cache_stats: ['cache hit numbers', 'how full are the caches', '缓存统计'],
  get_token_budget_stats: ['token budget usage', 'how many tokens left', 'token 预算'],
  install_extension: ['install a plugin from the registry', 'add this extension', '安装插件'],
  list_extensions: ['show installed plugins', 'what extensions exist', '列出插件'],
  maintenance_detect_gpu: ['detect the gpu on this host', 'graphics adapter probe', 'gpu 探测'],
  manual_token_cleanup: [
    'manually trim the token budget',
    'free token budget now',
    '手动清理 token',
  ],
  reload_extensions: ['hot reload all plugins', 'refresh extensions', '重载插件'],
  reset_token_budget: ['reset the token budget', 'give me a fresh budget', '重置 token 预算'],
  smart_cache_cleanup: ['intelligently clean caches', 'cleanup with retention policy', '智能清理'],
  snapshot_create: ['take a state snapshot', 'save the current server state', '创建快照'],
  snapshot_list: ['snapshots available', 'list saved states', '列出快照'],
  snapshot_restore: ['go back to a saved snapshot', 'restore server state', '恢复快照'],
};

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  secondaryDepKeys: ['extensionManagementHandlers', 'sandboxHandlers'],
  profiles: ['workflow', 'full'],
  ensure,
  registrations: [...coreRegistrations, ...extensionRegistrations, ...sandboxRegistrations],

  // Document-expansion keywords for the retrieval layer (SCENE_KEYWORDS above).
  sceneKeywords: SCENE_KEYWORDS,
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
