import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

export async function runProcessMemoryPhase(ctx) {
  const { report, state, clients, helpers } = ctx;
  const { client } = clients;
  const {
    withTimeout,
    callToolCaptureError,
    createClientTransport,
    isRecord,
    extractString,
    findFirstModule,
    getArrayFromRecord,
    findRegion,
    takeHexBytes,
    terminateProcessTree,
  } = helpers;
  const resources = state.runtimeResources;
  const { electronExePath, dummyApkPath, dummySoPath } = state.platformPaths;

  if (!(Number.isFinite(resources.memoryProbePid) && resources.memoryProbePid > 0)) {
    return;
  }

  report.process.enumerateModules = await callToolCaptureError(
    client,
    'enumerate_modules',
    { pid: resources.memoryProbePid },
    30000,
  );
  report.process.memoryListRegions = await callToolCaptureError(
    client,
    'memory_list_regions',
    { pid: resources.memoryProbePid },
    30000,
  );
  const firstModule = findFirstModule(report.process.enumerateModules);
  const moduleBase = typeof firstModule?.baseAddress === 'string' ? firstModule.baseAddress : '0x0';
  const secondModule = getArrayFromRecord(report.process.enumerateModules, 'modules').find(
    (entry) =>
      isRecord(entry) && typeof entry.baseAddress === 'string' && entry.baseAddress !== moduleBase,
  );
  const secondModuleBase =
    typeof secondModule?.baseAddress === 'string' ? secondModule.baseAddress : moduleBase;
  const firstWritableRegion = findRegion(report.process.memoryListRegions, (entry) =>
    typeof entry.protection === 'string' ? /w/i.test(entry.protection) : false,
  );
  const writableRegionBase =
    typeof firstWritableRegion?.baseAddress === 'string'
      ? firstWritableRegion.baseAddress
      : moduleBase;

  report.process.memoryRead = await callToolCaptureError(
    client,
    'memory_read',
    { pid: resources.memoryProbePid, address: moduleBase, size: 16 },
    30000,
  );
  const firstByteHex = takeHexBytes(report.process.memoryRead?.data, 1) || '4D';
  const firstByteValue = Number.parseInt(firstByteHex, 16);
  report.process.memoryCheckProtection = await callToolCaptureError(
    client,
    'memory_check_protection',
    { pid: resources.memoryProbePid, address: writableRegionBase },
    30000,
  );
  report.process.memoryWrite = await callToolCaptureError(
    client,
    'memory_write',
    {
      pid: resources.memoryProbePid,
      address: writableRegionBase,
      data: firstByteHex,
      encoding: 'hex',
    },
    30000,
  );
  report.process.memoryBatchWrite = await callToolCaptureError(
    client,
    'memory_batch_write',
    {
      pid: resources.memoryProbePid,
      patches: [{ address: writableRegionBase, data: firstByteHex, encoding: 'hex' }],
    },
    30000,
  );
  report.process.memoryScan = await callToolCaptureError(
    client,
    'memory_scan',
    { pid: resources.memoryProbePid, pattern: ctx.constants.MEMORY_MARKER, patternType: 'string' },
    45000,
  );
  const filteredAddresses = Array.isArray(report.process.memoryScan?.addresses)
    ? report.process.memoryScan.addresses.slice(0, 16)
    : [moduleBase];
  report.process.memoryScanFiltered = await callToolCaptureError(
    client,
    'memory_scan_filtered',
    {
      pid: resources.memoryProbePid,
      pattern: ctx.constants.MEMORY_MARKER,
      patternType: 'string',
      addresses: filteredAddresses,
    },
    30000,
  );
  report.process.memoryDumpRegion = await callToolCaptureError(
    client,
    'memory_dump_region',
    {
      pid: resources.memoryProbePid,
      address: moduleBase,
      size: 64,
      outputPath: '.tmp_mcp_artifacts/runtime-memory-region.bin',
    },
    30000,
  );
  report.memory.firstScan = await callToolCaptureError(
    client,
    'memory_first_scan',
    {
      pid: resources.memoryProbePid,
      value: Number.isFinite(firstByteValue) ? String(firstByteValue) : '77',
      valueType: 'byte',
      maxResults: 32,
    },
    45000,
  );
  const memoryScanSessionId =
    extractString(report.memory.firstScan, ['sessionId']) ?? 'missing-session';
  report.memory.nextScan = await callToolCaptureError(
    client,
    'memory_next_scan',
    { sessionId: memoryScanSessionId, mode: 'exact', value: ctx.constants.MEMORY_MARKER },
    30000,
  );
  report.memory.unknownScan = await callToolCaptureError(
    client,
    'memory_unknown_scan',
    { pid: resources.memoryProbePid, valueType: 'byte', maxResults: 64 },
    45000,
  );
  report.memory.pointerScan = await callToolCaptureError(
    client,
    'memory_pointer_scan',
    { pid: resources.memoryProbePid, targetAddress: moduleBase, maxResults: 16, moduleOnly: true },
    30000,
  );
  report.memory.groupScan = await callToolCaptureError(
    client,
    'memory_group_scan',
    {
      pid: resources.memoryProbePid,
      pattern: [{ offset: 0, value: '4D 5A', type: 'hex' }],
      maxResults: 16,
    },
    30000,
  );
  report.memory.scanSession = await callToolCaptureError(
    client,
    'memory_scan_session',
    { action: 'list' },
    15000,
  );
  report.memory.pointerChain = await callToolCaptureError(
    client,
    'memory_pointer_chain',
    {
      action: 'scan',
      pid: resources.memoryProbePid,
      targetAddress: moduleBase,
      maxDepth: 2,
      maxResults: 16,
    },
    30000,
  );
  report.memory.structureAnalyze = await callToolCaptureError(
    client,
    'memory_structure_analyze',
    { pid: resources.memoryProbePid, address: moduleBase, size: 64 },
    30000,
  );
  report.memory.vtableParse = await callToolCaptureError(
    client,
    'memory_vtable_parse',
    { pid: resources.memoryProbePid, vtableAddress: moduleBase },
    30000,
  );
  report.memory.structureExportC = await callToolCaptureError(
    client,
    'memory_structure_export_c',
    {
      structure: JSON.stringify({
        name: 'RuntimeAuditStruct',
        size: 8,
        fields: [{ name: 'flag', offset: 0, size: 4, type: 'uint32_t' }],
      }),
      name: 'RuntimeAuditStruct',
    },
    15000,
  );
  report.memory.structureCompare = await callToolCaptureError(
    client,
    'memory_structure_compare',
    { pid: resources.memoryProbePid, address1: moduleBase, address2: secondModuleBase, size: 64 },
    30000,
  );
  report.memory.breakpoint = await callToolCaptureError(
    client,
    'memory_breakpoint',
    { action: 'list' },
    15000,
  );
  report.memory.patchBytes = await callToolCaptureError(
    client,
    'memory_patch_bytes',
    { pid: resources.memoryProbePid, address: '0x1', bytes: [0x90] },
    30000,
  );
  report.memory.patchNop = await callToolCaptureError(
    client,
    'memory_patch_nop',
    { pid: resources.memoryProbePid, address: '0x1', count: 1 },
    30000,
  );
  report.memory.patchUndo = await callToolCaptureError(
    client,
    'memory_patch_undo',
    { patchId: 'missing-patch' },
    15000,
  );
  report.memory.codeCaves = await callToolCaptureError(
    client,
    'memory_code_caves',
    { pid: resources.memoryProbePid, minSize: 16 },
    30000,
  );
  report.memory.writeValue = await callToolCaptureError(
    client,
    'memory_write_value',
    {
      pid: resources.memoryProbePid,
      address: writableRegionBase,
      value: Number.isFinite(firstByteValue) ? String(firstByteValue) : '0',
      valueType: 'byte',
    },
    30000,
  );
  report.memory.freeze = await callToolCaptureError(
    client,
    'memory_freeze',
    { action: 'unfreeze', freezeId: 'missing-freeze' },
    15000,
  );
  report.memory.dump = await callToolCaptureError(
    client,
    'memory_dump',
    { pid: resources.memoryProbePid, address: moduleBase, size: 64 },
    30000,
  );
  const speedhackProbeProc = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  const speedhackProbePid = Number(speedhackProbeProc.pid ?? 0);
  try {
    report.memory.speedhack = await callToolCaptureError(
      client,
      'memory_speedhack',
      { action: 'apply', pid: speedhackProbePid, speed: 1 },
      30000,
    );
  } finally {
    await terminateProcessTree(speedhackProbeProc);
  }
  report.memory.writeHistory = await callToolCaptureError(
    client,
    'memory_write_history',
    { action: 'undo' },
    15000,
  );
  report.memory.heapEnumerate = await callToolCaptureError(
    client,
    'memory_heap_enumerate',
    { pid: resources.memoryProbePid, maxBlocks: 128 },
    30000,
  );
  report.memory.heapStats = await callToolCaptureError(
    client,
    'memory_heap_stats',
    { pid: resources.memoryProbePid },
    30000,
  );
  report.memory.heapAnomalies = await callToolCaptureError(
    client,
    'memory_heap_anomalies',
    { pid: resources.memoryProbePid },
    30000,
  );
  report.memory.peHeaders = await callToolCaptureError(
    client,
    'memory_pe_headers',
    { pid: resources.memoryProbePid, moduleBase },
    30000,
  );
  report.memory.peImportsExports = await callToolCaptureError(
    client,
    'memory_pe_imports_exports',
    { pid: resources.memoryProbePid, moduleBase, table: 'both' },
    30000,
  );
  report.memory.inlineHookDetect = await callToolCaptureError(
    client,
    'memory_inline_hook_detect',
    { pid: resources.memoryProbePid },
    30000,
  );
  report.memory.anticheatDetect = await callToolCaptureError(
    client,
    'memory_anticheat_detect',
    { pid: resources.memoryProbePid },
    30000,
  );
  report.memory.guardPages = await callToolCaptureError(
    client,
    'memory_guard_pages',
    { pid: resources.memoryProbePid },
    30000,
  );
  report.memory.integrityCheck = await callToolCaptureError(
    client,
    'memory_integrity_check',
    { pid: resources.memoryProbePid },
    30000,
  );
  const injectionProbeProc = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  const injectionProbePid = Number(injectionProbeProc.pid ?? 0);
  try {
    report.process.injectDll = await callToolCaptureError(
      client,
      'inject_dll',
      { pid: injectionProbePid, dllPath: `${state.platformProbeDir}/missing.dll` },
      30000,
    );
    report.process.injectShellcode = await callToolCaptureError(
      client,
      'inject_shellcode',
      { pid: injectionProbePid, shellcode: '90', encoding: 'hex' },
      30000,
    );
  } finally {
    injectionProbeProc.kill();
  }
  report.process.memoryAuditExport = await callToolCaptureError(
    client,
    'memory_audit_export',
    {},
    30000,
  );
  resources.isolatedBinaryClient = new Client(
    { name: 'runtime-tool-probe-binary-isolated', version: '1.0.0' },
    { capabilities: {} },
  );
  resources.isolatedBinaryTransport = createClientTransport('full', ctx.sharedEnv);
  await withTimeout(
    resources.isolatedBinaryClient.connect(resources.isolatedBinaryTransport),
    'connect-binary-isolated',
    30000,
  );
  report.binary.ghidraAnalyze = await callToolCaptureError(
    resources.isolatedBinaryClient,
    'ghidra_analyze',
    { binaryPath: electronExePath, timeout: 5000 },
    30000,
  );
  report.binary.ghidraDecompile = await callToolCaptureError(
    resources.isolatedBinaryClient,
    'ghidra_decompile',
    { binaryPath: electronExePath, functionName: 'createWindow' },
    30000,
  );
  report.binary.idaDecompile = await callToolCaptureError(
    resources.isolatedBinaryClient,
    'ida_decompile',
    { binaryPath: electronExePath, functionName: 'createWindow' },
    30000,
  );
  report.binary.jadxDecompile = await callToolCaptureError(
    resources.isolatedBinaryClient,
    'jadx_decompile',
    { apkPath: dummyApkPath, className: 'com.runtime.AuditActivity', methodName: 'onCreate' },
    30000,
  );
  report.binary.unidbgEmulate = await callToolCaptureError(
    resources.isolatedBinaryClient,
    'unidbg_emulate',
    { binaryPath: dummySoPath, functionName: 'JNI_OnLoad', args: ['1'] },
    30000,
  );
  report.binary.unidbgLaunch = await callToolCaptureError(
    resources.isolatedBinaryClient,
    'unidbg_launch',
    { soPath: dummySoPath, arch: 'arm64' },
    30000,
  );
  report.binary.unidbgCall = await callToolCaptureError(
    resources.isolatedBinaryClient,
    'unidbg_call',
    { sessionId: 'missing-session', functionName: 'JNI_OnLoad' },
    15000,
  );
  report.binary.unidbgTrace = await callToolCaptureError(
    resources.isolatedBinaryClient,
    'unidbg_trace',
    { sessionId: 'missing-session' },
    15000,
  );
}
