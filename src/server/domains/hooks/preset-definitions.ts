import type { PresetEntry } from './preset-builder.js';
import { CORE_PRESETS } from './preset-definitions.core.js';
import { SECURITY_PRESETS } from './preset-definitions.security.js';

export const PRESETS: Record<string, PresetEntry> = {
  ...CORE_PRESETS,
  ...SECURITY_PRESETS,
};

export const PRESET_LIST = Object.entries(PRESETS).map(([id, p]) => ({
  id,
  description: p.description,
}));
