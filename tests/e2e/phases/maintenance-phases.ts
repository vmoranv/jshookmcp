import type { Phase } from '@tests/e2e/helpers/types';

export const maintenancePhases: Phase[] = [
  {
    name: 'Maintenance & Cache',
    concurrent: true,
    group: 'compute-core',
    setup: [],
    tools: [
      'get_token_budget_stats',
      'manual_token_cleanup',
      'reset_token_budget',
      'get_cache_stats',
      'smart_cache_cleanup',
      'cleanup_artifacts',
      'doctor_environment',
      'list_extensions',
      'reload_extensions',
      'browse_extension_registry',
    ],
  },
];

export const cleanupPhases: Phase[] = [
  {
    name: 'Data Cleanup',
    concurrent: true,
    group: 'cleanup',
    setup: [],
    tools: ['clear_collected_data', 'clear_all_caches', 'get_collection_stats', 'browser_close'],
  },
];
