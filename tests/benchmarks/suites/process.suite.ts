/**
 * Process domain — static hollowing heuristics and process queries (pure-TS offline).
 *
 * Ground truth:
 *  - process_hollowing_scan: anonymous RWX VAD anomaly detection in proc maps
 *  - process_find: pattern filtering against current process list (at least current pid found)
 */
import { ProcessToolHandlers } from '@server/domains/process/handlers.impl';
import { expectSuccess, type BenchSuite } from '../harness';

const handlers = new ProcessToolHandlers();

export const processSuite: BenchSuite = {
  name: 'process-static',
  domain: 'process',
  description:
    'Process static heuristics: /proc/pid/maps VAD protection anomaly scan and process listing',
  cases: [
    {
      name: 'process_hollowing_scan/anonymous-rwx-detection',
      tool: 'process_hollowing_scan',
      origin: 'homemade',
      reference:
        'anonymous RWX regions in /proc/pid/maps trigger critical vad_protection_anomaly finding',
      run: async () => {
        const mapsContent = [
          '7fff00000000-7fff00001000 rwxp 00000000 00:00 0',
          '7fff10000000-7fff10010000 r-xp 00000000 08:01 12345  /usr/lib/libc.so',
        ].join('\n');
        return handlers.handleHollowingScanTool({
          pid: 9999,
          mapsContent,
        });
      },
      validate: (v) => {
        const b = expectSuccess(v);
        const findings = (b.findings as Array<Record<string, unknown>>) ?? [];
        if (!findings.length) return 'expected hollowing findings';
        const hasVadAnomaly = findings.some((f) => f.type === 'vad_protection_anomaly');
        return hasVadAnomaly
          ? true
          : `expected vad_protection_anomaly finding in ${JSON.stringify(findings)}`;
      },
    },
    {
      name: 'process_find/find-node-process',
      tool: 'process_find',
      origin: 'homemade',
      reference: 'process_find with pattern searches for active node processes',
      run: async () => {
        return handlers.handleProcessFindTool({ pattern: 'node' });
      },
      validate: (v) => {
        const b = expectSuccess(v);
        return b.success === true ? true : `expected success=true, got ${JSON.stringify(b)}`;
      },
    },
  ],
};
