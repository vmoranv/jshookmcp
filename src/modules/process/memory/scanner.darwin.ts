/**
 * macOS memory scanner — uses native Mach API (zero-pause) with lldb fallback.
 */
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logger } from '@utils/logger';
import type { MemoryScanResult } from '@modules/process/memory/types';
import { execAsync } from '@modules/process/memory/types';
import {
  MEMORY_SCAN_MAX_REGIONS,
  MEMORY_SCAN_MAX_RESULTS,
  MEMORY_SCAN_REGION_MAX_BYTES,
  MEMORY_SCAN_TIMEOUT_MS,
} from '@src/constants';
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
  // Caps are env-tunable via @src/constants (MEMORY_SCAN_*) and kept in sync
  // with the lldb fallback script below (which receives interpolated values).
  const maxResults = MEMORY_SCAN_MAX_RESULTS;
  const maxRegionSize = MEMORY_SCAN_REGION_MAX_BYTES;

  try {
    let address = 0n;
    for (let i = 0; i < MEMORY_SCAN_MAX_REGIONS && foundAddresses.length < maxResults; i++) {
      const region = provider.queryRegion(handle, address);
      if (!region) break;

      if (region.isReadable && region.size > 0 && region.size <= maxRegionSize) {
        try {
          const result = await provider.readMemory(handle, region.baseAddress, region.size);
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
  const pyFile = join(tmpdir(), `lldb_scan_${tag}_${randomUUID()}.py`);
  const cmdFile = join(tmpdir(), `lldb_scan_${tag}_${randomUUID()}.txt`);

  // Keep caps in sync with the native fast-path above (MEMORY_SCAN_* constants).
  const pyScript = `
import lldb, json, sys

MAX_RESULTS = ${MEMORY_SCAN_MAX_RESULTS}
MAX_REGION_SIZE = ${MEMORY_SCAN_REGION_MAX_BYTES}

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
        if sz > MAX_REGION_SIZE:
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
                if len(results) >= MAX_RESULTS:
                    break
        if len(results) >= MAX_RESULTS:
            break
    sys.stdout.write('SCAN_RESULT:' + json.dumps({
        'success': True,
        'addresses': results,
        'stats': {'patternLength': len(pat), 'resultsFound': len(results)}
    }) + '\\n')
    sys.stdout.flush()
`;

  await fs.writeFile(pyFile, pyScript, { encoding: 'utf8', flag: 'wx' });
  await fs.writeFile(cmdFile, `command script import ${pyFile}\nprocess detach\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  try {
    const { stdout } = await execAsync(`lldb --batch -p ${pid} --source ${cmdFile}`, {
      timeout: MEMORY_SCAN_TIMEOUT_MS,
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
    try {
      return JSON.parse(line.slice('SCAN_RESULT:'.length)) as MemoryScanResult;
    } catch {
      const errLine = stdout.split('\n').find((l) => l.includes('error:')) ?? '';
      if (errLine) {
        return {
          success: false,
          addresses: [],
          error: errLine.trim(),
        };
      }

      throw new Error('Unexpected end of JSON input');
    }
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
