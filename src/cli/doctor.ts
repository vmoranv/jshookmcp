#!/usr/bin/env node

import { bootstrapRuntimeEnv } from '@src/config/env-bootstrap';
import {
  formatEnvironmentDoctorReport,
  runEnvironmentDoctor,
} from '@server/domains/maintenance/environmentDoctor';

bootstrapRuntimeEnv();

const report = await runEnvironmentDoctor({ includeBridgeHealth: true });
process.stdout.write(`${formatEnvironmentDoctorReport(report)}\n`);
process.exit(0);
