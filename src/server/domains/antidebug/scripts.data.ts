import { ANTI_DEBUG_BYPASS_CORE_SCRIPTS } from '@server/domains/antidebug/scripts.data.bypass-core';
import { ANTI_DEBUG_BYPASS_CONSOLE_SCRIPT } from '@server/domains/antidebug/scripts.data.bypass-console';
import { ANTI_DEBUG_DETECT_SCRIPTS } from '@server/domains/antidebug/scripts.data.detect';

export const ANTI_DEBUG_SCRIPTS = {
  ...ANTI_DEBUG_BYPASS_CORE_SCRIPTS,
  ...ANTI_DEBUG_BYPASS_CONSOLE_SCRIPT,
  ...ANTI_DEBUG_DETECT_SCRIPTS,
} as const;
