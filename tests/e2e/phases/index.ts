import type { Phase } from '../helpers/types.js';
import { maintenancePhases, cleanupPhases } from './maintenance-phases.js';
import { browserPhases } from './browser-phases.js';
import { debuggerPhases } from './debugger-phases.js';
import { monitorPhases } from './monitor-phases.js';
import { analysisPhases } from './analysis-phases.js';
import { systemPhases } from './system-phases.js';

export const ALL_PHASES: Phase[] = [
  ...maintenancePhases,
  ...browserPhases,
  ...debuggerPhases,
  ...monitorPhases,
  ...analysisPhases,
  ...systemPhases,
  ...cleanupPhases,
];
