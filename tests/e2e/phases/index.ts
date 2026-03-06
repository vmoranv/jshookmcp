import type { Phase } from '@tests/e2e/helpers/types';
import { maintenancePhases, cleanupPhases } from '@tests/e2e/phases/maintenance-phases';
import { browserPhases } from '@tests/e2e/phases/browser-phases';
import { debuggerPhases } from '@tests/e2e/phases/debugger-phases';
import { monitorPhases } from '@tests/e2e/phases/monitor-phases';
import { analysisPhases } from '@tests/e2e/phases/analysis-phases';
import { systemPhases } from '@tests/e2e/phases/system-phases';

export const ALL_PHASES: Phase[] = [
  ...maintenancePhases,
  ...browserPhases,
  ...debuggerPhases,
  ...monitorPhases,
  ...analysisPhases,
  ...systemPhases,
  ...cleanupPhases,
];
