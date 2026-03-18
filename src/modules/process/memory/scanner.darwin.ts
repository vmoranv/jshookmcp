/**
 * macOS memory scanner — uses lldb + Python scripting.
 */
import { promises as fs } from 'node:fs';
import type { MemoryScanResult } from '@modules/process/memory/types';
import { execAsync } from '@modules/process/memory/types';
import { patternToBytesMac } from './scanner.patterns';

export async function scanMemoryMac(
  pid: number,
  pattern: string,
  patternType: string
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
