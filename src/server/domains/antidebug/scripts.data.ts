import { ANTI_DEBUG_BYPASS_CORE_SCRIPTS } from './scripts.data.bypass-core.js';
import { ANTI_DEBUG_BYPASS_CONSOLE_SCRIPT } from './scripts.data.bypass-console.js';
import { ANTI_DEBUG_DETECT_SCRIPTS } from './scripts.data.detect.js';

export const ANTI_DEBUG_SCRIPTS = {
  ...ANTI_DEBUG_BYPASS_CORE_SCRIPTS,
  ...ANTI_DEBUG_BYPASS_CONSOLE_SCRIPT,
  ...ANTI_DEBUG_DETECT_SCRIPTS,
} as const;
