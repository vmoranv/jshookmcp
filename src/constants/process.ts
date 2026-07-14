/**
 * Process inspection: hollowing detection limits, injection guards.
 * Prefixes: PROCESS_*
 */

import { int } from './helpers.js';

/* ================================================================== */
/*  Hollowing detection memory-dump limits                             */
/* ================================================================== */

/** Max differing sections to include in a hollowing-detection memory dump. */
export const PROCESS_HOLLOWING_MAX_DUMP_SECTIONS = int('PROCESS_HOLLOWING_MAX_DUMP_SECTIONS', 3);

/** Max bytes per section read during a hollowing-detection memory dump. */
export const PROCESS_HOLLOWING_MAX_BYTES_PER_SECTION = int(
  'PROCESS_HOLLOWING_MAX_BYTES_PER_SECTION',
  65_536,
);
