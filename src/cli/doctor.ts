#!/usr/bin/env node

import { bootstrapRuntimeEnv } from '@src/config/env-bootstrap';
import {
  formatEnvironmentDoctorReport,
  runEnvironmentDoctor,
} from '@server/domains/maintenance/environmentDoctor';

bootstrapRuntimeEnv();

const report = await runEnvironmentDoctor({ includeBridgeHealth: true });
process.stdout.write(`${formatEnvironmentDoctorReport(report)}\n`);
// Let stdout drain; CI detects a failed doctor via the process exit code.
process.exitCode = report.success ? 0 : 1;
