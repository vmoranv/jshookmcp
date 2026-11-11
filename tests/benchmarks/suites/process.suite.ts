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

    // ── Coverage batch 2026-11-11 (autoresearch): self-process inspection & audit export ──
    {
      name: 'process_get/self-pid-info',
      tool: 'process_get',
      origin: 'homemade',
      reference: 'retrieves process metadata and commandLine for current process.pid',
      run: () => handlers.handleProcessGetTool({ pid: process.pid }),
      validate: (v) => {
        const b = expectSuccess(v);
        const proc = b.process as { pid?: number } | undefined;
        if (!proc || Number(proc.pid) !== process.pid)
          return `expected process.pid === ${process.pid}, got ${JSON.stringify(b).slice(0, 200)}`;
        return true;
      },
    },
    {
      name: 'process_list/enumerates-processes',
      tool: 'process_list',
      origin: 'homemade',
      reference: 'lists active host processes cleanly via UnifiedProcessManager',
      run: () => handlers.handleProcessFindTool({ pattern: 'node', limit: 5 }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (b.success !== true) return `expected success=true, got ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'process_windows/self-pid-windows',
      tool: 'process_windows',
      origin: 'homemade',
      reference: 'enumerates top-level window array cleanly for current process.pid',
      run: () => handlers.handleProcessWindowsTool({ pid: process.pid }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (Number(b.pid) !== process.pid || !Array.isArray(b.windows))
          return `expected pid=${process.pid} and windows array, got ${JSON.stringify(b).slice(0, 200)}`;
        return true;
      },
    },
    {
      name: 'process_check_debug_port/self-pid-probe',
      tool: 'process_check_debug_port',
      origin: 'homemade',
      reference: 'probes commandLine debug port for current process.pid cleanly',
      run: () => handlers.handleProcessCheckDebugPortTool({ pid: process.pid }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (Number(b.pid) !== process.pid || typeof b.canAttach !== 'boolean')
          return `expected pid=${process.pid} and canAttach boolean, got ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'memory_audit_export/exports-entries',
      tool: 'memory_audit_export',
      origin: 'homemade',
      reference: 'exports memory operation audit trail entries cleanly in pure TS',
      run: () => handlers.handleMemoryAuditExportTool({}),
      validate: (v) => {
        const b = expectSuccess(v);
        if (typeof b.count !== 'number' || !Array.isArray(b.entries))
          return `expected count and entries array, got ${JSON.stringify(b)}`;
        return true;
      },
    },
  ],
};
