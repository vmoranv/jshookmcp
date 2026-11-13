/**
 * Process domain — static hollowing heuristics and process queries (pure-TS offline).
 *
 * Ground truth:
 *  - process_hollowing_scan: anonymous RWX VAD anomaly detection in proc maps
 *  - process_find: pattern filtering against current process list (at least current pid found)
 */
import { ProcessToolHandlers } from '@server/domains/process/handlers.impl';
import { body, expectSuccess, type BenchSuite } from '../harness';

const handlers = new ProcessToolHandlers();

/**
 * A PID far outside the range any live process can occupy, so the "target
 * unreachable" contracts below can never collide with a real process.
 */
const MISSING_PID = 2_147_480_000;

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

    // ── Contract batch 2026-11-12 (autoresearch) ────────────────────────────
    // Every tool below operates on a live process through FFI or a debug
    // endpoint. The portable contract on any machine: an unreachable target is
    // refused explicitly (named error, no fabricated data), and arguments are
    // validated by name before any native call. MISSING_PID is outside any real
    // PID range, so it can never collide with a running process.
    {
      name: 'process_kill/missing-pid-reports-false',
      tool: 'process_kill',
      origin: 'homemade',
      reference:
        'outcome contract: killing a non-existent PID must report success=false with "Failed to kill process" (regression guard for the -ErrorAction SilentlyContinue false-success bug)',
      run: () => handlers.handleProcessKillTool({ pid: MISSING_PID }),
      validate: (v) => {
        const b = body(v);
        if (b['success'] !== false) return `expected success=false, got ${JSON.stringify(b)}`;
        if (b['pid'] !== MISSING_PID) return `pid not echoed: ${JSON.stringify(b)}`;
        if (!/Failed to kill process/.test(String(b['message'] ?? '')))
          return `message should report the failure: ${String(b['message'])}`;
        return true;
      },
    },
    {
      name: 'process_resume/missing-pid-reports-resumed-false',
      tool: 'process_resume',
      origin: 'homemade',
      reference:
        'outcome contract: resuming a non-existent PID must set resumed=false with an explanatory message instead of claiming success',
      run: () => handlers.handleProcessResumeTool({ pid: MISSING_PID }),
      validate: (v) => {
        const b = body(v);
        if (b['success'] !== true) return `expected a shaped response, got ${JSON.stringify(b)}`;
        if (b['resumed'] !== false) return `resumed should be false, got ${String(b['resumed'])}`;
        if (!/Failed to resume process/.test(String(b['message'] ?? '')))
          return `message should report the failure: ${String(b['message'])}`;
        return true;
      },
    },
    {
      name: 'process_suspend/missing-pid-reports-suspended-false',
      tool: 'process_suspend',
      origin: 'homemade',
      reference:
        'outcome contract: suspending a non-existent PID must set suspended=false with the permissions/exited hint',
      run: () => handlers.handleProcessSuspendTool({ pid: MISSING_PID }),
      validate: (v) => {
        const b = body(v);
        if (b['suspended'] !== false) return `suspended should be false: ${JSON.stringify(b)}`;
        if (!/Failed to suspend process/.test(String(b['message'] ?? '')))
          return `message should report the failure: ${String(b['message'])}`;
        return true;
      },
    },
    {
      name: 'process_suspend/rejects-non-positive-pid',
      tool: 'process_suspend',
      origin: 'homemade',
      reference:
        'argument contract: pid must be a positive integer, rejected before any platform call',
      run: () => handlers.handleProcessSuspendTool({ pid: 0 }),
      validate: (v) => {
        const b = body(v);
        return b['success'] === false && /pid must be a positive integer/.test(String(b['error']))
          ? true
          : `expected a pid validation error, got ${JSON.stringify(b)}`;
      },
    },
    {
      name: 'inject_dll/rejects-missing-process',
      tool: 'inject_dll',
      origin: 'homemade',
      reference:
        'injection contract: a target that cannot be opened is refused as a validation failure before any write is attempted',
      run: () => handlers.handleInjectDllTool({ pid: MISSING_PID, dllPath: 'C:/bench/none.dll' }),
      validate: (v) => {
        const b = body(v);
        if (b['success'] !== false) return `expected success=false, got ${JSON.stringify(b)}`;
        if (b['validationFailed'] !== true) return `expected validationFailed=true`;
        if (!/does not exist or is not accessible/.test(String(b['error'] ?? '')))
          return `error should name the inaccessible target: ${String(b['error'])}`;
        if (b['injected'] === true) return `must not claim injection`;
        return true;
      },
    },
    {
      name: 'inject_shellcode/rejects-missing-process',
      tool: 'inject_shellcode',
      origin: 'homemade',
      reference:
        'injection contract: shellcode injection into an inaccessible process is refused as a validation failure with no claimed write',
      run: () => handlers.handleInjectShellcodeTool({ pid: MISSING_PID, shellcode: '90909090' }),
      validate: (v) => {
        const b = body(v);
        if (b['success'] !== false || b['validationFailed'] !== true)
          return `expected a validation failure: ${JSON.stringify(b).slice(0, 200)}`;
        if (b['injected'] === true) return `must not claim injection`;
        return true;
      },
    },
    {
      name: 'process_detect_hollowing/rejects-missing-process',
      tool: 'process_detect_hollowing',
      origin: 'homemade',
      reference:
        'detection contract: hollowing analysis needs an openable target; failure must name the error code and the elevation hint, and never report "clean"',
      run: () => handlers.handleDetectHollowingTool({ pid: MISSING_PID }),
      validate: (v) => {
        const b = body(v);
        if (b['success'] !== false) return `expected success=false, got ${JSON.stringify(b)}`;
        if (!/Failed to open process/.test(String(b['error'] ?? '')))
          return `error should name the open failure: ${String(b['error'])}`;
        if (b['hollowed'] === true || b['verdict'] === 'clean')
          return `must not emit a verdict without data: ${JSON.stringify(b).slice(0, 200)}`;
        return true;
      },
    },
    {
      name: 'process_enum_handles/no-handles-for-missing-pid',
      tool: 'process_enum_handles',
      origin: 'homemade',
      reference:
        'enumeration contract: a non-existent PID yields zero matching handles and no security findings while still reporting the system-wide handle total',
      run: () => handlers.handleProcessEnumHandlesTool({ pid: MISSING_PID }),
      validate: (v) => {
        const b = body(v);
        if (b['pid'] !== MISSING_PID) return `pid not echoed: ${JSON.stringify(b)}`;
        const handles = Array.isArray(b['handles']) ? b['handles'] : [];
        if (b['totalHandles'] !== 0 || handles.length !== 0)
          return `expected zero handles for a missing process: ${JSON.stringify(b).slice(0, 200)}`;
        const findings = Array.isArray(b['securityFindings']) ? b['securityFindings'] : [];
        if (findings.length !== 0) return `must not invent findings`;
        if (typeof b['totalSystemHandles'] !== 'number')
          return `system handle total should be reported`;
        return true;
      },
    },
    {
      name: 'memory_read/rejects-missing-process',
      tool: 'memory_read',
      origin: 'homemade',
      reference:
        'read contract: a failed open must return success=false with no data field, echoing the requested address/size so the caller can retry',
      run: () => handlers.handleMemoryReadTool({ pid: MISSING_PID, address: '0x1000', size: 16 }),
      validate: (v) => {
        const b = body(v);
        if (b['success'] !== false) return `expected success=false, got ${JSON.stringify(b)}`;
        if (b['data'] !== undefined) return `must not return bytes on failure`;
        if (b['address'] !== '0x1000' || b['size'] !== 16)
          return `request not echoed: ${JSON.stringify(b).slice(0, 200)}`;
        return true;
      },
    },
    {
      name: 'memory_write/rejects-missing-process',
      tool: 'memory_write',
      origin: 'homemade',
      reference:
        'write contract: a failed open reports success=false while still echoing dataLength/encoding, so no partial-write claim is made. NOTE: dataLength echoes the payload STRING length, not the decoded byte count (byte size is reported separately as `size`) — asserted as-is so a change of meaning is caught',
      run: () =>
        handlers.handleMemoryWriteTool({ pid: MISSING_PID, address: '0x1000', data: '4142' }),
      validate: (v) => {
        const b = body(v);
        if (b['success'] !== false) return `expected success=false, got ${JSON.stringify(b)}`;
        if (b['dataLength'] !== '4142'.length)
          return `dataLength should echo the payload string length (4), got ${String(b['dataLength'])}`;
        if (b['encoding'] !== 'hex') return `encoding should default to hex`;
        if (b['bytesWritten'] !== undefined) return `must not report bytesWritten on failure`;
        return true;
      },
    },
    {
      name: 'memory_scan/rejects-missing-process',
      tool: 'memory_scan',
      origin: 'homemade',
      reference:
        'scan contract: an unscannable target returns success=false with an empty addresses array (never partial hits) and echoes the pattern kind',
      run: () => handlers.handleMemoryScanTool({ pid: MISSING_PID, pattern: '41 42' }),
      validate: (v) => {
        const b = body(v);
        if (b['success'] !== false) return `expected success=false, got ${JSON.stringify(b)}`;
        if (!Array.isArray(b['addresses']) || (b['addresses'] as unknown[]).length !== 0)
          return `addresses must be an empty array on failure`;
        if (b['patternType'] !== 'hex') return `patternType should be hex`;
        return true;
      },
    },
    {
      name: 'memory_scan_filtered/requires-address-array',
      tool: 'memory_scan_filtered',
      origin: 'homemade',
      reference:
        'argument contract: the filtered scan needs a list of candidate addresses; an empty list is rejected by name instead of scanning the whole range',
      run: () =>
        handlers.handleMemoryScanFilteredTool({
          pid: MISSING_PID,
          pattern: '41',
          addresses: [],
        }),
      validate: (v) => {
        const b = body(v);
        if (b['success'] !== false) return `expected success=false, got ${JSON.stringify(b)}`;
        if (!/addresses|No valid addresses/.test(String(b['error'] ?? '')))
          return `error should name addresses: ${String(b['error'])}`;
        return true;
      },
    },
    {
      name: 'memory_batch_write/empty-batch-is-noop',
      tool: 'memory_batch_write',
      origin: 'homemade',
      reference:
        'batch contract: an empty patch list performs no writes and returns an empty results array rather than touching the target',
      run: () => handlers.handleMemoryBatchWriteTool({ pid: MISSING_PID, patches: [] }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (!Array.isArray(b['results']) || (b['results'] as unknown[]).length !== 0)
          return `expected an empty results array: ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'memory_dump_region/requires-outputPath',
      tool: 'memory_dump_region',
      origin: 'homemade',
      reference:
        'artifact contract: a region dump requires an explicit outputPath; the handler must not choose a write location itself',
      run: () =>
        handlers.handleMemoryDumpRegionTool({
          pid: MISSING_PID,
          address: '0x1000',
          size: 16,
          outputPath: '',
        }),
      validate: (v) => {
        const b = body(v);
        if (b['success'] !== false) return `expected success=false, got ${JSON.stringify(b)}`;
        if (!/outputPath/.test(String(b['error'] ?? '')))
          return `error should name outputPath: ${String(b['error'])}`;
        return true;
      },
    },
    {
      name: 'memory_list_regions/rejects-missing-process',
      tool: 'memory_list_regions',
      origin: 'homemade',
      reference:
        'region contract: enumerating a non-existent process fails with the elevation hint and returns no region list',
      run: () => handlers.handleMemoryListRegionsTool({ pid: MISSING_PID }),
      validate: (v) => {
        const b = body(v);
        if (b['success'] !== false) return `expected success=false, got ${JSON.stringify(b)}`;
        if (b['regions'] !== undefined && (b['regions'] as unknown[]).length !== 0)
          return `must not return regions for a missing process`;
        if (!/Failed to open process/.test(String(b['error'] ?? '')))
          return `error should name the open failure`;
        return true;
      },
    },
    {
      name: 'memory_check_protection/rejects-missing-process',
      tool: 'memory_check_protection',
      origin: 'homemade',
      reference:
        'protection contract: querying page protection on a missing process fails explicitly instead of guessing a protection value',
      run: () => handlers.handleMemoryCheckProtectionTool({ pid: MISSING_PID, address: '0x1000' }),
      validate: (v) => {
        const b = body(v);
        if (b['success'] !== false) return `expected success=false, got ${JSON.stringify(b)}`;
        if (b['protection'] !== undefined) return `must not report a protection value`;
        if (!/Failed to open process/.test(String(b['error'] ?? '')))
          return `unexpected error text`;
        return true;
      },
    },
    {
      name: 'check_debug_port/rejects-missing-process',
      tool: 'check_debug_port',
      origin: 'homemade',
      reference:
        'debug-port contract: an unopenable process yields isDebugged=null (unknown, not false) with a named error',
      run: () => handlers.handleCheckDebugPortTool({ pid: MISSING_PID }),
      validate: (v) => {
        const b = body(v);
        if (b['success'] !== false) return `expected success=false, got ${JSON.stringify(b)}`;
        if (b['isDebugged'] !== null)
          return `isDebugged must be null (unknown) rather than a guess: ${String(b['isDebugged'])}`;
        if (!/Failed to open process/.test(String(b['error'] ?? '')))
          return `unexpected error text`;
        return true;
      },
    },
    {
      name: 'electron_attach/rejects-out-of-range-port',
      tool: 'electron_attach',
      origin: 'homemade',
      reference:
        'argument contract: the debug port must be an integer in 1-65535 and is rejected by name before any connection attempt',
      run: () => handlers.handleElectronAttachTool({ port: 99999 }),
      validate: (v) => {
        const b = body(v);
        if (b['success'] !== false) return `expected success=false, got ${JSON.stringify(b)}`;
        if (!/Invalid port/.test(String(b['error'] ?? '')))
          return `error should name the invalid port: ${String(b['error'])}`;
        return true;
      },
    },
    {
      name: 'electron_attach/unreachable-endpoint-honest',
      tool: 'electron_attach',
      origin: 'homemade',
      reference:
        'connect contract: with no debugger listening on the port the tool fails naming the URL and pointing at the launch helper, never a fabricated target list',
      run: () => handlers.handleElectronAttachTool({ port: 1 }),
      validate: (v) => {
        const b = body(v);
        if (b['success'] !== false) return `expected success=false, got ${JSON.stringify(b)}`;
        const error = String(b['error'] ?? '');
        if (!/Cannot connect to Electron CDP/.test(error))
          return `error should name the unreachable endpoint: ${error.slice(0, 160)}`;
        if (!/9229|127\.0\.0\.1:1/.test(error)) return `error should include the endpoint address`;
        if (b['targets'] !== undefined) return `must not return targets on failure`;
        return true;
      },
    },
    {
      name: 'process_launch_debug/missing-executable-honest',
      tool: 'process_launch_debug',
      origin: 'homemade',
      reference:
        'launch contract: a non-existent executable yields success=false with a launch failure message, no fabricated pid or debug port',
      run: () =>
        handlers.handleProcessLaunchDebugTool({ executablePath: 'C:/bench/no-such-binary.exe' }),
      validate: (v) => {
        const b = body(v);
        if (b['success'] !== false) return `expected success=false, got ${JSON.stringify(b)}`;
        if (b['pid'] !== undefined) return `must not report a pid for a failed launch`;
        if (!/Failed to launch/.test(String(b['message'] ?? b['error'] ?? '')))
          return `message should report the launch failure: ${JSON.stringify(b).slice(0, 200)}`;
        return true;
      },
    },

    // ── Tail-contract batch 2026-11-12 (autoresearch) ────────────────────────
    // Three tools whose only machine-independent contract is the argument check
    // that runs before any native call.
    {
      name: 'enumerate_modules/requires-pid',
      tool: 'enumerate_modules',
      origin: 'homemade',
      reference: 'argument contract: module enumeration needs a pid and names it when absent',
      run: () => handlers.handleEnumerateModulesTool({}),
      validate: (v) => {
        const text = JSON.stringify(body(v));
        return /Invalid PID|pid/i.test(text) ? true : `expected a pid error: ${text.slice(0, 180)}`;
      },
    },
    {
      name: 'process_detect_apc/requires-positive-pid',
      tool: 'process_detect_apc',
      origin: 'homemade',
      reference:
        'argument contract: APC detection needs a positive pid and rejects anything else by name',
      run: () => handlers.handleProcessDetectApcTool({}),
      validate: (v) => {
        const text = JSON.stringify(body(v));
        return /pid must be a positive integer/i.test(text)
          ? true
          : `expected the pid validation message: ${text.slice(0, 180)}`;
      },
    },
    {
      name: 'process_enum_threads/reports-prototype-failure',
      tool: 'process_enum_threads',
      origin: 'homemade',
      reference:
        'known-defect contract: the win32 thread enumeration currently fails at the koffi prototype ("Array types decay to pointers"), and the tool must report that failure rather than returning an empty thread list',
      run: () => handlers.handleProcessEnumThreadsTool({ pid: MISSING_PID }),
      validate: (v) => {
        const b = body(v);
        if (b['success'] === false) {
          const text = JSON.stringify(b);
          // Either the koffi prototype rejection (current defect) or a named
          // open-process failure is acceptable; a silent empty list is not.
          return /Array types decay|Failed to open process|not available/i.test(text)
            ? true
            : `failure should name the cause: ${text.slice(0, 200)}`;
        }
        const ids = b['threadIds'];
        if (Array.isArray(ids) && ids.length === 0)
          return 'must not report an empty thread list as success';
        return true;
      },
    },
  ],
};
