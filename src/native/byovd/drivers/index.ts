/**
 * BYOVD driver registry.
 *
 * All known vulnerable driver definitions are registered here.
 * The ByovdManager loads a driver by name from this registry.
 */

import type { ByovdDriverDef } from '../types';
import { RTCore64 } from './RTCore64';
import { KProcessHacker } from './KProcessHacker';
import { ThrottleStop } from './ThrottleStop';

/** Master registry of all known BYOVD driver definitions. */
export const byovdDriverRegistry: readonly ByovdDriverDef[] = [
  RTCore64,
  KProcessHacker,
  ThrottleStop,
] as const;

/** Look up a driver definition by name (case-insensitive). */
export function findDriver(name: string): ByovdDriverDef | undefined {
  const lower = name.toLowerCase();
  return byovdDriverRegistry.find((d) => d.name.toLowerCase() === lower);
}
