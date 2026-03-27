/**
 * macOS memory scanner — uses native Mach API (zero-pause) with lldb fallback.
 */
import { promises as fs } from 'node:fs';
import { logger } from '@utils/logger';
import type { MemoryScanResult } from '@modules/process/memory/types';
import { execAsync } from '@modules/process/memory/types';
import { patternToBytesMac } from './scanner.patterns';
import { findPatternInBuffer } from '@native/NativeMemoryManager.utils';

export async function scanMemoryMac(
  pid: number,
  pattern: string,
  patternType: string,
): Promise<MemoryScanResult> {
  let patternBytes: number[];
  let patternMask: number[];
  try {
    const result = patternToBytesMac(pattern, patternType);
    patternBytes = result.bytes;
    patternMask = result.mask;
  } catch (e) {
    return {
      success: false,
      addresses: [],
      error: e instanceof Error ? e.message : 'Invalid pattern',
    };
  }

  // ── Native fast-path: task_for_pid + mach_vm_region/read (zero-pause) ──
  try {
    const nativeResult = await scanMemoryMacNative(pid, patternBytes, patternMask);
    if (nativeResult) return nativeResult;
  } catch (nativeErr) {
    logger.debug('Native Mach scan failed, falling back to lldb:', nativeErr);
  }

  // ── Fallback: lldb + Python scripting (pauses target briefly) ──
  return scanMemoryMacLldb(pid, patternBytes, patternMask);
}

/**
 * Native scan using Mach kernel APIs — zero target pause.
 * Returns null if the native provider is unavailable.
 */
async function scanMemoryMacNative(
  pid: number,
  patternBytes: number[],
  patternMask: number[],
): Promise<MemoryScanResult | null> {
  const { createPlatformProvider } = await import('@native/platform/factory.js');
  const provider = createPlatformProvider();
  const avail = await provider.checkAvailability();
  if (!avail.available) return null;

  const handle = provider.openProcess(pid, false);
  const foundAddresses: string[] = [];
  const maxResults = 1000;
  const maxRegionSize = 32 * 1024 * 1024; // 32MB cap per region

  try {
    let address = 0n;
    for (let i = 0; i < 50000 && foundAddresses.length < maxResults; i++) {
      const region = provider.queryRegion(handle, address);
      if (!region) break;

      if (region.isReadable && region.size > 0 && region.size <= maxRegionSize) {
        try {
          const result = provider.readMemory(handle, region.baseAddress, region.size);
          const matches = findPatternInBuffer(result.data, patternBytes, patternMask);
          for (const offset of matches) {
            foundAddresses.push(`0x${(region.baseAddress + BigInt(offset)).toString(16)}`);
            if (foundAddresses.length >= maxResults) break;
          }
        } catch {
          // Skip unreadable regions
        }
      }

      address = region.baseAddress + BigInt(region.size);
      if (address <= region.baseAddress) break; // overflow guard
    }
  } finally {
    provider.closeProcess(handle);
  }

  logger.debug(`Native Mach scan completed (zero-pause): ${foundAddresses.length} results`);
  return {
    success: true,
    addresses: foundAddresses,
    stats: { patternLength: patternBytes.length, resultsFound: foundAddresses.length },
  };
}

/**
 * lldb-based scan fallback — uses Python scripting.
 */
async function scanMemoryMacLldb(
  pid: number,
  patternBytes: number[],
  patternMask: number[],
): Promise<MemoryScanResult> {
  const byteList = patternBytes.map((b) => `0x${b.toString(16)}`).join(',');
  const maskList = patternMask.join(',');
  const tag = `${pid}_${Date.now()}`;
  const pyFile = `/tmp/lldb_scan_${tag}.py`;
  const cmdFile = `/tmp/lldb_scan_${tag}.txt`;

  const pyScript = `
import lldb, json, sys

def __lldb_init_module(debugger, internal_dict):
    proc = debugger.GetSelectedTarget().GetProcess()
    pat = bytes([${byteList}])
    mask = [${maskList}]
    results = []
    rl = proc.GetMemoryRegions()
    for i in range(rl.GetSize()):
        info = lldb.SBMemoryRegionInfo()
        rl.GetMemoryRegionAtIndex(i, info)
        if not info.IsReadable():
            continue
        s = info.GetRegionBase()
        sz = info.GetRegionEnd() - s
        if sz > 32 * 1024 * 1024:
            continue
        err = lldb.SBError()
        data = proc.ReadMemory(s, sz, err)
        if not err.Success():
            continue
        n = len(pat)
        for j in range(len(data) - n + 1):
            match = True
            for k in range(n):
                if mask[k] == 1 and data[j+k] != pat[k]:
                    match = False
                    break
            if match:
                results.append(hex(s + j))
                if len(results) >= 1000:
                    break
        if len(results) >= 1000:
            break
    sys.stdout.write('SCAN_RESULT:' + json.dumps({
        'success': True,
        'addresses': results,
        'stats': {'patternLength': len(pat), 'resultsFound': len(results)}
    }) + '\\n')
    sys.stdout.flush()
`;

  await fs.writeFile(pyFile, pyScript, 'utf8');
  await fs.writeFile(cmdFile, `command script import ${pyFile}\nprocess detach\n`, 'utf8');
  try {
    const { stdout } = await execAsync(`lldb --batch -p ${pid} --source ${cmdFile}`, {
      timeout: 120000,
      maxBuffer: 1024 * 1024 * 5,
    });
    const line = stdout.split('\n').find((l) => l.startsWith('SCAN_RESULT:'));
    if (!line) {
      const errLine = stdout.split('\n').find((l) => l.includes('error:')) ?? '';
      return {
        success: false,
        addresses: [],
        error: `lldb scan returned no result. ${errLine}`.trim(),
      };
    }
    return JSON.parse(line.slice('SCAN_RESULT:'.length)) as MemoryScanResult;
  } catch (error) {
    return {
      success: false,
      addresses: [],
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await fs.unlink(pyFile).catch(() => {});
    await fs.unlink(cmdFile).catch(() => {});
  }
}
