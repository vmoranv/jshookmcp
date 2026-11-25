/**
 * BYOVD (Bring Your Own Vulnerable Driver) constants.
 *
 * All BYOVD operations are gated behind JSHOOK_BYOVD_ENABLE=1.
 * Loading kernel drivers is inherently dangerous — these constants
 * are deliberately conservative to minimise BSOD risk.
 */

import { bool, int } from './helpers';

/** Master enable gate — must be explicitly set to '1'. */
export const BYOVD_ENABLED = bool('JSHOOK_BYOVD_ENABLE', false);

/** Maximum IOCTL calls per second (rate-limit guard). */
export const BYOVD_MAX_IOCTL_PER_SEC = int('BYOVD_MAX_IOCTL_PER_SEC', 100, { min: 1 });

/** Maximum bytes per single read operation. */
export const BYOVD_MAX_READ_BYTES = int('BYOVD_MAX_READ_BYTES', 1024 * 1024, { min: 1 });

/** Maximum bytes per single write operation. */
export const BYOVD_MAX_WRITE_BYTES = int('BYOVD_MAX_WRITE_BYTES', 64 * 1024, { min: 1 });

/** Timeout (ms) for driver service start. */
export const BYOVD_SERVICE_START_TIMEOUT_MS = int('BYOVD_SERVICE_START_TIMEOUT_MS', 30_000, {
  min: 1,
});

/** Timeout (ms) for driver service stop. */
export const BYOVD_SERVICE_STOP_TIMEOUT_MS = int('BYOVD_SERVICE_STOP_TIMEOUT_MS', 30_000, {
  min: 1,
});

/** Chunk size for physical-memory R/W (ThrottleStop supports 1/2/4/8 byte ops). */
const BYOVD_PHYSICAL_CHUNK_SIZE_RAW = int('BYOVD_PHYSICAL_CHUNK_SIZE', 8);
export const BYOVD_PHYSICAL_CHUNK_SIZE =
  BYOVD_PHYSICAL_CHUNK_SIZE_RAW === 1 ||
  BYOVD_PHYSICAL_CHUNK_SIZE_RAW === 2 ||
  BYOVD_PHYSICAL_CHUNK_SIZE_RAW === 4 ||
  BYOVD_PHYSICAL_CHUNK_SIZE_RAW === 8
    ? BYOVD_PHYSICAL_CHUNK_SIZE_RAW
    : 8;
