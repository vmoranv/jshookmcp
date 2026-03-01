import type { Phase } from '../helpers/types.js';

export const maintenancePhases: Phase[] = [
  {
    name: 'Maintenance & Cache',
    setup: [],
    tools: [
      'get_token_budget_stats', 'manual_token_cleanup', 'reset_token_budget',
      'get_cache_stats', 'smart_cache_cleanup',
      'boost_profile', 'unboost_profile',
    ],
  },
];

export const cleanupPhases: Phase[] = [
  {
    name: 'Data Cleanup',
    setup: [],
    tools: ['clear_collected_data', 'clear_all_caches', 'get_collection_stats', 'browser_close'],
  },
];
