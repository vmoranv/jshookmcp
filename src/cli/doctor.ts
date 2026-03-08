#!/usr/bin/env node

import { formatEnvironmentDoctorReport, runEnvironmentDoctor } from '@utils/environmentDoctor';

const report = await runEnvironmentDoctor({ includeBridgeHealth: true });
process.stdout.write(`${formatEnvironmentDoctorReport(report)}\n`);
process.exit(0);
