import type { DomainManifest } from '../../registry/contracts.js';
import { toolLookup } from '../../registry/types.js';
import { bindByDepKey } from '../../registry/bind-helpers.js';
import { tokenBudgetTools, cacheTools } from './definitions.js';
import { CoreMaintenanceHandlers } from './index.js';
import type { MCPServerContext } from '../../MCPServer.context.js';

const DOMAIN = 'maintenance' as const;
const DEP_KEY = 'coreMaintenanceHandlers' as const;
type H = CoreMaintenanceHandlers;
const t = toolLookup([...tokenBudgetTools, ...cacheTools]);
const b = (invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);

function ensure(ctx: MCPServerContext): H {
  if (!ctx.coreMaintenanceHandlers) {
    ctx.coreMaintenanceHandlers = new CoreMaintenanceHandlers({
      tokenBudget: ctx.tokenBudget,
      unifiedCache: ctx.unifiedCache,
    });
  }
  return ctx.coreMaintenanceHandlers;
}

const manifest: DomainManifest<typeof DEP_KEY, H, typeof DOMAIN> = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['search', 'minimal', 'workflow', 'full', 'reverse'],
  ensure,
  registrations: [
    { tool: t('get_token_budget_stats'), domain: DOMAIN, bind: b((h) => h.handleGetTokenBudgetStats()) },
    { tool: t('manual_token_cleanup'), domain: DOMAIN, bind: b((h) => h.handleManualTokenCleanup()) },
    { tool: t('reset_token_budget'), domain: DOMAIN, bind: b((h) => h.handleResetTokenBudget()) },
    { tool: t('get_cache_stats'), domain: DOMAIN, bind: b((h) => h.handleGetCacheStats()) },
    { tool: t('smart_cache_cleanup'), domain: DOMAIN, bind: b((h, a) => h.handleSmartCacheCleanup(a.targetSize as number | undefined)) },
    { tool: t('clear_all_caches'), domain: DOMAIN, bind: b((h) => h.handleClearAllCaches()) },
  ],
};

export default manifest;
