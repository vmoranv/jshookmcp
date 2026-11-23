import { rmSyncWithRetries } from '../lib/fs-retry.mjs';

rmSyncWithRetries('dist', { recursive: true, force: true });
