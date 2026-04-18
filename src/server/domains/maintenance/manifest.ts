import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, toolLookup } from '@server/domains/shared/registry';
import {
  tokenBudgetTools,
  cacheTools,
  extensionTools,
  artifactTools,
} from '@server/domains/maintenance/definitions';
import {
  CoreMaintenanceHandlers,
  ExtensionManagementHandlers,
} from '@server/domains/maintenance/index';

const DOMAIN = 'maintenance' as const;
const DEP_KEY = 'coreMaintenanceHandlers' as const;
const EXT_DEP_KEY = 'extensionManagementHandlers' as const;
type H = CoreMaintenanceHandlers;
type E = ExtensionManagementHandlers;
const t = toolLookup([...tokenBudgetTools, ...cacheTools, ...artifactTools, ...extensionTools]);
const b = (invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);
const be = (invoke: (h: E, a: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<E>(EXT_DEP_KEY, invoke);

function ensure(ctx: MCPServerContext): H {
  if (!ctx.coreMaintenanceHandlers) {
    ctx.coreMaintenanceHandlers = new CoreMaintenanceHandlers({
      tokenBudget: ctx.tokenBudget,
      unifiedCache: ctx.unifiedCache,
    });
  }
  if (!ctx.extensionManagementHandlers) {
    ctx.extensionManagementHandlers = new ExtensionManagementHandlers(ctx);
  }
  return ctx.coreMaintenanceHandlers;
}

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  secondaryDepKeys: ['extensionManagementHandlers'],
  profiles: ['full'],
  ensure,
  registrations: [
    {
      tool: t('get_token_budget_stats'),
      domain: DOMAIN,
      bind: b((h) => h.handleGetTokenBudgetStats()),
    },
    {
      tool: t('manual_token_cleanup'),
      domain: DOMAIN,
      bind: b((h) => h.handleManualTokenCleanup()),
    },
    {
      tool: t('reset_token_budget'),
      domain: DOMAIN,
      bind: b((h) => h.handleResetTokenBudget()),
      profiles: ['full'],
    },
    { tool: t('get_cache_stats'), domain: DOMAIN, bind: b((h) => h.handleGetCacheStats()) },
    {
      tool: t('smart_cache_cleanup'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleSmartCacheCleanup(a.targetSize as number | undefined)),
    },
    {
      tool: t('clear_all_caches'),
      domain: DOMAIN,
      bind: b((h) => h.handleClearAllCaches()),
      profiles: ['full'],
    },
    {
      tool: t('cleanup_artifacts'),
      domain: DOMAIN,
      bind: b((h, a) =>
        h.handleCleanupArtifacts({
          retentionDays: a.retentionDays as number | undefined,
          maxTotalBytes: a.maxTotalBytes as number | undefined,
          dryRun: a.dryRun as boolean | undefined,
        }),
      ),
      profiles: ['full'],
    },
    {
      tool: t('doctor_environment'),
      domain: DOMAIN,
      bind: b((h, a) =>
        h.handleEnvironmentDoctor({
          includeBridgeHealth: a.includeBridgeHealth as boolean | undefined,
        }),
      ),
      profiles: ['full'],
    },
    { tool: t('list_extensions'), domain: DOMAIN, bind: be((h) => h.handleListExtensions()) },
    { tool: t('reload_extensions'), domain: DOMAIN, bind: be((h) => h.handleReloadExtensions()) },
    {
      tool: t('browse_extension_registry'),
      domain: DOMAIN,
      bind: be((h, a) => h.handleBrowseExtensionRegistry((a.kind as string) ?? 'all')),
      profiles: ['full'],
    },
    {
      tool: t('install_extension'),
      domain: DOMAIN,
      bind: be((h, a) =>
        h.handleInstallExtension(a.slug as string, a.targetDir as string | undefined),
      ),
      profiles: ['full'],
    },
  ],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
