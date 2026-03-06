import type { PresetEntry } from '@server/domains/hooks/preset-builder';
import { CORE_PRESETS } from '@server/domains/hooks/preset-definitions.core';
import { SECURITY_PRESETS } from '@server/domains/hooks/preset-definitions.security';

export const PRESETS: Record<string, PresetEntry> = {
  ...CORE_PRESETS,
  ...SECURITY_PRESETS,
};

export const PRESET_LIST = Object.entries(PRESETS).map(([id, p]) => ({
  id,
  description: p.description,
}));
