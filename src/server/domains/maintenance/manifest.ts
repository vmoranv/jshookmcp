import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { defineMethodRegistrations, toolLookup } from '@server/domains/shared/registry';
import type { ArtifactCategory } from '@utils/artifacts';
import {
  tokenBudgetTools,
  cacheTools,
  extensionTools,
  artifactTools,
  sandboxTools,
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
const coreToolDefinitions = [...tokenBudgetTools, ...cacheTools, ...artifactTools] as const;
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

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  secondaryDepKeys: ['extensionManagementHandlers', 'sandboxHandlers'],
  profiles: ['workflow', 'full'],
  ensure,
  registrations: [...coreRegistrations, ...extensionRegistrations, ...sandboxRegistrations],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
