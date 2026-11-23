import { rmSync } from 'node:fs';

const RETRYABLE_RM_CODES = new Set(['EBUSY', 'ENOTEMPTY', 'EPERM']);

export function rmSyncWithRetries(path, options = {}) {
  try {
    rmSync(path, {
      ...options,
      maxRetries: options.maxRetries ?? 5,
      retryDelay: options.retryDelay ?? 250,
    });
  } catch (error) {
    if (!RETRYABLE_RM_CODES.has(error?.code)) throw error;
    rmSync(path, {
      ...options,
      maxRetries: options.maxRetries ?? 10,
      retryDelay: options.retryDelay ?? 500,
    });
  }
}
