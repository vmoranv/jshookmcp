import type { ToolRegistration } from '../../registry/types.js';
import { toolLookup } from '../../registry/types.js';
import { tokenBudgetTools, cacheTools } from './definitions.js';

const t = toolLookup([...tokenBudgetTools, ...cacheTools]);

export const maintenanceRegistrations: readonly ToolRegistration[] = [
  { tool: t('get_token_budget_stats'), domain: 'maintenance', bind: (d) => () => d.coreMaintenanceHandlers.handleGetTokenBudgetStats() },
  { tool: t('manual_token_cleanup'), domain: 'maintenance', bind: (d) => () => d.coreMaintenanceHandlers.handleManualTokenCleanup() },
  { tool: t('reset_token_budget'), domain: 'maintenance', bind: (d) => () => d.coreMaintenanceHandlers.handleResetTokenBudget() },
  { tool: t('get_cache_stats'), domain: 'maintenance', bind: (d) => () => d.coreMaintenanceHandlers.handleGetCacheStats() },
  { tool: t('smart_cache_cleanup'), domain: 'maintenance', bind: (d) => (a) => d.coreMaintenanceHandlers.handleSmartCacheCleanup(a.targetSize as number | undefined) },
  { tool: t('clear_all_caches'), domain: 'maintenance', bind: (d) => () => d.coreMaintenanceHandlers.handleClearAllCaches() },
];
