/**
 * Cross-platform Memory Manager
 * Provides memory read/write/scan operations for Windows, Linux, and macOS
 *
 * PERFORMANCE: Uses koffi FFI for direct Win32 API calls (10-100x faster than PowerShell)
 * FALLBACK: Automatically falls back to PowerShell when native is unavailable
 *
 * WARNING: These operations require elevated privileges and can crash target processes.
 * Use with caution and only on processes you own or have permission to debug.
 */

import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../../utils/logger.js';
import { nativeMemoryManager } from '../../native/NativeMemoryManager.js';
import { isKoffiAvailable } from '../../native/Win32API.js';
// Platform detection - duplicated here to avoid circular dependency with index.ts
function detectPlatform(): 'win32' | 'linux' | 'darwin' | 'unknown' {
  const platform = process.platform;
  switch (platform) {
    case 'win32': return 'win32';
    case 'linux': return 'linux';
    case 'darwin': return 'darwin';
    default: return 'unknown';
  }
}

type Platform = 'win32' | 'linux' | 'darwin' | 'unknown';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export interface MemoryReadResult {
  success: boolean;
  data?: string; // hex encoded
  error?: string;
}

export interface MemoryWriteResult {
  success: boolean;
  bytesWritten?: number;
  error?: string;
}

export interface MemoryScanResult {
  success: boolean;
  addresses: string[]; // hex addresses where pattern was found
  error?: string;
  stats?: {
    patternLength: number;
    resultsFound: number;
  };
}

/**
 * Memory Manager - Cross-platform memory operations
 */
export class MemoryManager {
  private platform: Platform;
  private readonly windowsAvailabilityCacheTtlMs = 45_000;
  private windowsAvailabilityCache:
    | { expiresAt: number; result: { available: boolean; reason?: string } }
    | null = null;

  constructor() {
    this.platform = detectPlatform();
    logger.info(`MemoryManager initialized for platform: ${this.platform}`);
  }

  /**
   * Read memory from a process
   * @param pid Target process ID
   * @param address Memory address (hex string like "0x12345678")
   * @param size Number of bytes to read
   */
  async readMemory(pid: number, address: string, size: number): Promise<MemoryReadResult> {
    try {
      // Validate address
      const addrNum = parseInt(address, 16);
      if (isNaN(addrNum)) {
        return { success: false, error: 'Invalid address format. Use hex like "0x12345678"' };
      }

      // Try native FFI first on Windows (10-100x faster)
      if (this.platform === 'win32' && isKoffiAvailable()) {
        try {
          const result = await nativeMemoryManager.readMemory(pid, address, size);
          if (result.success) {
            logger.debug('Native memory read succeeded');
            return result;
          }
          logger.warn('Native memory read failed, falling back to PowerShell:', result.error);
        } catch (nativeError) {
          logger.warn('Native memory read error, falling back to PowerShell:', nativeError);
        }
      }

      switch (this.platform) {
        case 'win32':
          return this.readMemoryWindows(pid, addrNum, size);
        case 'linux':
          return this.readMemoryLinux(pid, addrNum, size);
        case 'darwin':
          return this.readMemoryMac(pid, addrNum, size);
        default:
          return { success: false, error: `Memory operations not supported on platform: ${this.platform}` };
      }
    } catch (error) {
      logger.error('Memory read failed:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Write memory to a process
   * @param pid Target process ID
   * @param address Memory address (hex string)
   * @param data Data to write (hex string)
   * @param encoding 'hex' or 'base64'
   */
  async writeMemory(
    pid: number,
    address: string,
    data: string,
    encoding: 'hex' | 'base64' = 'hex'
  ): Promise<MemoryWriteResult> {
    try {
      const addrNum = parseInt(address, 16);
      if (isNaN(addrNum)) {
        return { success: false, error: 'Invalid address format' };
      }

      // Decode data
      let buffer: Buffer;
      try {
        if (encoding === 'base64') {
          buffer = Buffer.from(data, 'base64');
        } else {
          // Remove spaces and convert hex
          const cleanHex = data.replace(/\s/g, '');
          buffer = Buffer.from(cleanHex, 'hex');
        }
      } catch (e) {
        return { success: false, error: `Invalid ${encoding} data` };
      }

      // Try native FFI first on Windows (10-100x faster)
      if (this.platform === 'win32' && isKoffiAvailable()) {
        try {
          const result = await nativeMemoryManager.writeMemory(pid, address, data, encoding);
          if (result.success) {
            logger.debug('Native memory write succeeded');
            return result;
          }
          logger.warn('Native memory write failed, falling back to PowerShell:', result.error);
        } catch (nativeError) {
          logger.warn('Native memory write error, falling back to PowerShell:', nativeError);
        }
      }

      switch (this.platform) {
        case 'win32':
          return this.writeMemoryWindows(pid, addrNum, buffer);
        case 'linux':
          return this.writeMemoryLinux(pid, addrNum, buffer);
        case 'darwin':
          return this.writeMemoryMac(pid, addrNum, buffer);
        default:
          return { success: false, error: `Memory operations not supported on platform: ${this.platform}` };
      }
    } catch (error) {
      logger.error('Memory write failed:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Scan memory for a pattern
   * @param pid Target process ID
   * @param pattern Pattern to search (hex bytes like "48 8B 05" or value)
   * @param patternType Type of pattern
   */
  async scanMemory(
    pid: number,
    pattern: string,
    patternType: 'hex' | 'int32' | 'int64' | 'float' | 'double' | 'string' = 'hex'
  ): Promise<MemoryScanResult> {
    try {
      switch (this.platform) {
        case 'win32':
          return this.scanMemoryWindows(pid, pattern, patternType);
        case 'linux':
          return this.scanMemoryLinux(pid, pattern, patternType);
        case 'darwin':
          return this.scanMemoryMac(pid, pattern, patternType);
        default:
          return { success: false, addresses: [], error: `Memory scan not supported on ${this.platform}` };
      }
    } catch (error) {
      logger.error('Memory scan failed:', error);
      return { success: false, addresses: [], error: error instanceof Error ? error.message : String(error) };
    }
  }

  // ==================== Windows Implementation ====================

  private async readMemoryWindows(pid: number, address: number, size: number): Promise<MemoryReadResult> {
    try {
      // Use PowerShell with P/Invoke to ReadProcessMemory
      const psScript = `
        Add-Type @"
          using System;
          using System.Runtime.InteropServices;
          using System.ComponentModel;

          public class MemoryReader {
            [DllImport("kernel32.dll", SetLastError = true)]
            public static extern IntPtr OpenProcess(int access, bool inherit, int pid);

            [DllImport("kernel32.dll", SetLastError = true)]
            public static extern bool ReadProcessMemory(IntPtr hProcess, IntPtr addr, byte[] buffer, int size, out int read);

            [DllImport("kernel32.dll", SetLastError = true)]
            public static extern bool CloseHandle(IntPtr handle);

            const int PROCESS_VM_READ = 0x0010;
            const int PROCESS_QUERY_INFORMATION = 0x0400;

            public static string ReadMemory(int pid, long address, int size) {
              IntPtr hProcess = OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, false, pid);
              if (hProcess == IntPtr.Zero) {
                int error = Marshal.GetLastWin32Error();
                throw new Win32Exception(error, "Failed to open process. Run as Administrator.");
              }

              try {
                byte[] buffer = new byte[size];
                int bytesRead;
                bool success = ReadProcessMemory(hProcess, (IntPtr)address, buffer, size, out bytesRead);

                if (!success) {
                  int error = Marshal.GetLastWin32Error();
                  throw new Win32Exception(error, "Failed to read memory");
                }

                return BitConverter.ToString(buffer, 0, bytesRead).Replace("-", " ");
              } finally {
                CloseHandle(hProcess);
              }
            }
          }
"@

        try {
          $result = [MemoryReader]::ReadMemory(${pid}, ${address}, ${size})
          @{ success = $true; data = $result } | ConvertTo-Json -Compress
        } catch {
          @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
        }
      `;

      const { stdout } = await this.executePowerShellScript(psScript, { maxBuffer: 1024 * 1024 * 10 }
      );

      const result = JSON.parse(stdout.trim());
      return {
        success: result.success,
        data: result.data,
        error: result.error,
      };
    } catch (error) {
      logger.error('Windows memory read failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'PowerShell execution failed. Run as Administrator.',
      };
    }
  }

  private async writeMemoryWindows(pid: number, address: number, data: Buffer): Promise<MemoryWriteResult> {
    try {
      const hexData = data.toString('hex').toUpperCase();

      const psScript = `
        Add-Type @"
          using System;
          using System.Runtime.InteropServices;
          using System.ComponentModel;

          public class MemoryWriter {
            [DllImport("kernel32.dll", SetLastError = true)]
            public static extern IntPtr OpenProcess(int access, bool inherit, int pid);

            [DllImport("kernel32.dll", SetLastError = true)]
            public static extern bool WriteProcessMemory(IntPtr hProcess, IntPtr addr, byte[] buffer, int size, out int written);

            [DllImport("kernel32.dll", SetLastError = true)]
            public static extern bool CloseHandle(IntPtr handle);

            const int PROCESS_VM_WRITE = 0x0020;
            const int PROCESS_VM_OPERATION = 0x0008;

            public static int WriteMemory(int pid, long address, string hexData) {
              IntPtr hProcess = OpenProcess(PROCESS_VM_WRITE | PROCESS_VM_OPERATION, false, pid);
              if (hProcess == IntPtr.Zero) {
                int error = Marshal.GetLastWin32Error();
                throw new Win32Exception(error, "Failed to open process. Run as Administrator.");
              }

              try {
                byte[] buffer = new byte[hexData.Length / 2];
                for (int i = 0; i < hexData.Length; i += 2) {
                  buffer[i / 2] = Convert.ToByte(hexData.Substring(i, 2), 16);
                }

                int bytesWritten;
                bool success = WriteProcessMemory(hProcess, (IntPtr)address, buffer, buffer.Length, out bytesWritten);

                if (!success) {
                  int error = Marshal.GetLastWin32Error();
                  throw new Win32Exception(error, "Failed to write memory");
                }

                return bytesWritten;
              } finally {
                CloseHandle(hProcess);
              }
            }
          }
"@

        try {
          $bytesWritten = [MemoryWriter]::WriteMemory(${pid}, ${address}, "${hexData}")
          @{ success = $true; bytesWritten = $bytesWritten } | ConvertTo-Json -Compress
        } catch {
          @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
        }
      `;

      const { stdout } = await this.executePowerShellScript(psScript, { maxBuffer: 1024 * 1024 }
      );

      const result = JSON.parse(stdout.trim());
      return {
        success: result.success,
        bytesWritten: result.bytesWritten,
        error: result.error,
      };
    } catch (error) {
      logger.error('Windows memory write failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'PowerShell execution failed. Run as Administrator.',
      };
    }
  }

  private async scanMemoryWindows(
    pid: number,
    pattern: string,
    patternType: string
  ): Promise<MemoryScanResult> {
    try {
      const psScript = this.buildMemoryScanScript(pid, pattern, patternType);

      const { stdout, stderr } = await this.executePowerShellScript(psScript, { maxBuffer: 1024 * 1024 * 50, timeout: 120000 }
      );

      if (stderr && stderr.includes('Error')) {
        return {
          success: false,
          addresses: [],
          error: stderr,
        };
      }

      const result = JSON.parse(stdout.trim());
      return {
        success: result.success,
        addresses: result.addresses || [],
        error: result.error,
        stats: result.stats,
      };
    } catch (error) {
      logger.error('Windows memory scan failed:', error);
      return {
        success: false,
        addresses: [],
        error: error instanceof Error ? error.message : 'PowerShell execution failed. Run as Administrator.',
      };
    }
  }

  private buildMemoryScanScript(pid: number, pattern: string, patternType: string): string {
    let patternBytes: number[] = [];
    let mask: number[] = [];

    switch (patternType) {
      case 'hex':
        const hexParts = pattern.trim().split(/\s+/);
        for (const part of hexParts) {
          if (part === '??' || part === '**' || part === '?') {
            patternBytes.push(0);
            mask.push(0);
          } else {
            const byte = parseInt(part, 16);
            if (!isNaN(byte)) {
              patternBytes.push(byte);
              mask.push(1);
            }
          }
        }
        break;
      case 'int32':
        const int32Val = parseInt(pattern);
        if (!isNaN(int32Val)) {
          const buf = Buffer.allocUnsafe(4);
          buf.writeInt32LE(int32Val, 0);
          patternBytes = Array.from(buf);
          mask = [1, 1, 1, 1];
        }
        break;
      case 'int64':
        const int64Val = BigInt.asIntN(64, BigInt(pattern));
        const buf64 = Buffer.allocUnsafe(8);
        buf64.writeBigInt64LE(int64Val, 0);
        patternBytes = Array.from(buf64);
        mask = [1, 1, 1, 1, 1, 1, 1, 1];
        break;
      case 'float':
        const floatVal = parseFloat(pattern);
        if (!isNaN(floatVal)) {
          const bufFloat = Buffer.allocUnsafe(4);
          bufFloat.writeFloatLE(floatVal, 0);
          patternBytes = Array.from(bufFloat);
          mask = [1, 1, 1, 1];
        }
        break;
      case 'double':
        const doubleVal = parseFloat(pattern);
        if (!isNaN(doubleVal)) {
          const bufDouble = Buffer.allocUnsafe(8);
          bufDouble.writeDoubleLE(doubleVal, 0);
          patternBytes = Array.from(bufDouble);
          mask = [1, 1, 1, 1, 1, 1, 1, 1];
        }
        break;
      case 'string':
        const stringBuf = Buffer.from(pattern, 'utf8');
        patternBytes = Array.from(stringBuf);
        mask = patternBytes.map(() => 1);
        break;
    }

    if (patternBytes.length === 0) {
      throw new Error('Invalid pattern');
    }

    const patternArray = patternBytes.join(',');
    const maskArray = mask.join(',');

    return `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.ComponentModel;

public class MemoryScanner {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(int access, bool inherit, int pid);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool ReadProcessMemory(IntPtr hProcess, IntPtr addr, byte[] buffer, int size, out int read);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern int VirtualQueryEx(IntPtr hProcess, IntPtr addr, out MEMORY_BASIC_INFORMATION info, int size);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr handle);

    const int PROCESS_VM_READ = 0x0010;
    const int PROCESS_QUERY_INFORMATION = 0x0400;

    [StructLayout(LayoutKind.Sequential)]
    public struct MEMORY_BASIC_INFORMATION {
        public IntPtr BaseAddress;
        public IntPtr AllocationBase;
        public uint AllocationProtect;
        public IntPtr RegionSize;
        public uint State;
        public uint Protect;
        public uint Type;
    }

    const uint MEM_COMMIT = 0x1000;
    const uint PAGE_READONLY = 0x02;
    const uint PAGE_READWRITE = 0x04;
    const uint PAGE_WRITECOPY = 0x08;
    const uint PAGE_EXECUTE_READ = 0x20;
    const uint PAGE_EXECUTE_READWRITE = 0x40;

    public static List<string> ScanMemory(int pid, byte[] pattern, byte[] mask, int maxResults = 10000) {
        var results = new List<string>();
        IntPtr hProcess = OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, false, pid);
        if (hProcess == IntPtr.Zero) {
            int error = Marshal.GetLastWin32Error();
            throw new Win32Exception(error, "Failed to open process. Run as Administrator.");
        }

        try {
            IntPtr addr = IntPtr.Zero;
            MEMORY_BASIC_INFORMATION info;
            int infoSize = Marshal.SizeOf(typeof(MEMORY_BASIC_INFORMATION));
            int scannedRegions = 0;

            while (VirtualQueryEx(hProcess, addr, out info, infoSize) == infoSize) {
                scannedRegions++;
                bool isReadable = (info.State == MEM_COMMIT) &&
                    ((info.Protect & PAGE_READONLY) != 0 ||
                     (info.Protect & PAGE_READWRITE) != 0 ||
                     (info.Protect & PAGE_WRITECOPY) != 0 ||
                     (info.Protect & PAGE_EXECUTE_READ) != 0 ||
                     (info.Protect & PAGE_EXECUTE_READWRITE) != 0);

                if (isReadable && info.RegionSize.ToInt64() > 0 && info.RegionSize.ToInt64() < 1073741824) {
                    long regionSize = info.RegionSize.ToInt64();
                    if (regionSize > 16777216) regionSize = 16777216; // bound scan window per region (16MB)
                    byte[] buffer = new byte[(int)regionSize];
                    int bytesRead;

                    if (ReadProcessMemory(hProcess, info.BaseAddress, buffer, buffer.Length, out bytesRead)) {
                        for (int i = 0; i <= bytesRead - pattern.Length; i++) {
                            if (PatternMatch(buffer, i, pattern, mask)) {
                                long foundAddr = info.BaseAddress.ToInt64() + i;
                                results.Add("0x" + foundAddr.ToString("X"));
                                if (results.Count >= maxResults) break;
                            }
                        }
                    }
                }

                if (results.Count >= maxResults) break;
                if (scannedRegions >= 50000) break;
                long baseAddr = info.BaseAddress.ToInt64();
                long regionSizeRaw = info.RegionSize.ToInt64();
                if (regionSizeRaw <= 0) break;
                long nextAddr = baseAddr + regionSizeRaw;
                if (nextAddr <= baseAddr) break;
                addr = new IntPtr(nextAddr);
                if (addr.ToInt64() >= 0x7FFFFFFF0000) break;
            }

            return results;
        } finally {
            CloseHandle(hProcess);
        }
    }

    private static bool PatternMatch(byte[] buffer, int offset, byte[] pattern, byte[] mask) {
        for (int i = 0; i < pattern.Length; i++) {
            if (mask[i] == 1 && buffer[offset + i] != pattern[i]) {
                return false;
            }
        }
        return true;
    }
}
"@

try {
    $patternBytes = @(${patternArray})
    $maskBytes = @(${maskArray})
    $results = [MemoryScanner]::ScanMemory(${pid}, $patternBytes, $maskBytes, 1000)
    @{
        success = $true;
        addresses = $results;
        stats = @{
            patternLength = $patternBytes.Length;
            resultsFound = $results.Count
        }
    } | ConvertTo-Json -Compress
} catch {
    @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
    `.trim();
  }

  /**
   * Dump memory region to file (Windows)
   */
  async dumpMemoryRegion(pid: number, startAddress: string, size: number, outputPath: string): Promise<{ success: boolean; error?: string }> {
    if (this.platform !== 'win32') {
      return { success: false, error: 'Memory dump currently only implemented for Windows' };
    }

    try {
      const addrNum = parseInt(startAddress, 16);
      if (isNaN(addrNum)) {
        return { success: false, error: 'Invalid address format' };
      }

      const psScript = this.buildMemoryDumpScript(pid, addrNum, size, outputPath);

      const { stdout } = await this.executePowerShellScript(psScript, { maxBuffer: 1024 * 1024, timeout: 60000 }
      );

      const result = JSON.parse(stdout.trim());
      return {
        success: result.success,
        error: result.error,
      };
    } catch (error) {
      logger.error('Memory dump failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'PowerShell execution failed',
      };
    }
  }

  private buildMemoryDumpScript(pid: number, address: number, size: number, outputPath: string): string {
    return `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.IO;
using System.ComponentModel;

public class MemoryDumper {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(int access, bool inherit, int pid);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool ReadProcessMemory(IntPtr hProcess, IntPtr addr, byte[] buffer, int size, out int read);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr handle);

    const int PROCESS_VM_READ = 0x0010;
    const int PROCESS_QUERY_INFORMATION = 0x0400;

    public static string DumpMemory(int pid, long address, int size, string outputPath) {
        IntPtr hProcess = OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, false, pid);
        if (hProcess == IntPtr.Zero) {
            int error = Marshal.GetLastWin32Error();
            throw new Win32Exception(error, "Failed to open process. Run as Administrator.");
        }

        try {
            byte[] buffer = new byte[size];
            int bytesRead;

            if (!ReadProcessMemory(hProcess, (IntPtr)address, buffer, size, out bytesRead)) {
                int error = Marshal.GetLastWin32Error();
                throw new Win32Exception(error, "Failed to read memory");
            }

            File.WriteAllBytes(outputPath, buffer);
            return "Dumped " + bytesRead + " bytes to " + outputPath;
        } finally {
            CloseHandle(hProcess);
        }
    }
}
"@

try {
    $result = [MemoryDumper]::DumpMemory(${pid}, ${address}, ${size}, "${outputPath.replace(/\\/g, '\\\\')}")
    @{ success = $true; message = $result } | ConvertTo-Json -Compress
} catch {
    @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
    `.trim();
  }

  /**
   * Enumerate memory regions (Windows)
   */
  async enumerateRegions(pid: number): Promise<{ success: boolean; regions?: any[]; error?: string }> {
    if (this.platform !== 'win32') {
      return { success: false, error: 'Region enumeration currently only implemented for Windows' };
    }

    try {
      const psScript = this.buildEnumerateRegionsScript(pid);

      const { stdout } = await this.executePowerShellScript(psScript, { maxBuffer: 1024 * 1024 * 10, timeout: 30000 }
      );

      const result = JSON.parse(stdout.trim());
      return {
        success: result.success,
        regions: result.regions,
        error: result.error,
      };
    } catch (error) {
      logger.error('Region enumeration failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'PowerShell execution failed',
      };
    }
  }

  private buildEnumerateRegionsScript(pid: number): string {
    return `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.ComponentModel;

public class RegionEnumerator {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(int access, bool inherit, int pid);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern int VirtualQueryEx(IntPtr hProcess, IntPtr addr, out MEMORY_BASIC_INFORMATION info, int size);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr handle);

    const int PROCESS_QUERY_INFORMATION = 0x0400;

    [StructLayout(LayoutKind.Sequential)]
    public struct MEMORY_BASIC_INFORMATION {
        public IntPtr BaseAddress;
        public IntPtr AllocationBase;
        public uint AllocationProtect;
        public IntPtr RegionSize;
        public uint State;
        public uint Protect;
        public uint Type;
    }

    const uint MEM_COMMIT = 0x1000;
    const uint MEM_FREE = 0x10000;
    const uint MEM_RESERVE = 0x2000;
    const uint PAGE_READONLY = 0x02;
    const uint PAGE_READWRITE = 0x04;
    const uint PAGE_WRITECOPY = 0x08;
    const uint PAGE_EXECUTE = 0x10;
    const uint PAGE_EXECUTE_READ = 0x20;
    const uint PAGE_EXECUTE_READWRITE = 0x40;

    public static List<object> EnumerateRegions(int pid) {
        var regions = new List<object>();
        IntPtr hProcess = OpenProcess(PROCESS_QUERY_INFORMATION, false, pid);
        if (hProcess == IntPtr.Zero) {
            int error = Marshal.GetLastWin32Error();
            throw new Win32Exception(error, "Failed to open process. Run as Administrator.");
        }

        try {
            IntPtr addr = IntPtr.Zero;
            MEMORY_BASIC_INFORMATION info;
            int infoSize = Marshal.SizeOf(typeof(MEMORY_BASIC_INFORMATION));
            int scannedRegions = 0;

            while (VirtualQueryEx(hProcess, addr, out info, infoSize) == infoSize) {
                scannedRegions++;
                string state = info.State == MEM_COMMIT ? "COMMIT" : (info.State == MEM_RESERVE ? "RESERVE" : (info.State == MEM_FREE ? "FREE" : "UNKNOWN"));
                string protect = GetProtectionString(info.Protect);
                bool isReadable = (info.State == MEM_COMMIT) && ((info.Protect & (PAGE_READONLY | PAGE_READWRITE | PAGE_EXECUTE_READ | PAGE_EXECUTE_READWRITE)) != 0);

                regions.Add(new {
                    baseAddress = "0x" + info.BaseAddress.ToInt64().ToString("X"),
                    size = info.RegionSize.ToInt64(),
                    state = state,
                    protection = protect,
                    isReadable = isReadable,
                    type = info.Type == 0x1000000 ? "IMAGE" : (info.Type == 0x40000 ? "MAPPED" : "PRIVATE")
                });

                if (regions.Count >= 10000 || scannedRegions >= 50000) break;
                long baseAddr = info.BaseAddress.ToInt64();
                long regionSize = info.RegionSize.ToInt64();
                if (regionSize <= 0) break;
                long nextAddr = baseAddr + regionSize;
                if (nextAddr <= baseAddr) break;
                addr = new IntPtr(nextAddr);
                if (addr.ToInt64() >= 0x7FFFFFFF0000) break;
            }

            return regions;
        } finally {
            CloseHandle(hProcess);
        }
    }

    private static string GetProtectionString(uint protect) {
        if (protect == 0) return "NOACCESS";
        string s = "";
        if ((protect & 0x100) != 0) s += "NOACCESS ";
        if ((protect & PAGE_READONLY) != 0) s += "R ";
        if ((protect & PAGE_READWRITE) != 0) s += "RW ";
        if ((protect & PAGE_WRITECOPY) != 0) s += "W ";
        if ((protect & PAGE_EXECUTE) != 0) s += "X ";
        if ((protect & PAGE_EXECUTE_READ) != 0) s += "RX ";
        if ((protect & PAGE_EXECUTE_READWRITE) != 0) s += "RWX ";
        if ((protect & 0x100) != 0) s += "GUARD ";
        return s.Trim();
    }
}
"@

try {
    $regions = [RegionEnumerator]::EnumerateRegions(${pid})
    @{ success = $true; regions = $regions; count = $regions.Count } | ConvertTo-Json -Compress -Depth 10
} catch {
    @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
    `.trim();
  }

  // ==================== Advanced Memory Features ====================

  /**
   * Check memory protection at specific address (Windows)
   * Returns protection flags and writability status
   */
  async checkMemoryProtection(pid: number, address: string): Promise<{
    success: boolean;
    protection?: string;
    isWritable?: boolean;
    isReadable?: boolean;
    isExecutable?: boolean;
    regionStart?: string;
    regionSize?: number;
    error?: string;
  }> {
    if (this.platform !== 'win32') {
      return { success: false, error: 'Memory protection check currently only implemented for Windows' };
    }

    try {
      const addrNum = parseInt(address, 16);
      if (isNaN(addrNum)) {
        return { success: false, error: 'Invalid address format' };
      }

      const psScript = this.buildProtectionCheckScript(pid, addrNum);

      const { stdout } = await this.executePowerShellScript(psScript, { maxBuffer: 1024 * 1024, timeout: 30000 }
      );

      const result = JSON.parse(stdout.trim());
      return {
        success: result.success,
        protection: result.protection,
        isWritable: result.isWritable,
        isReadable: result.isReadable,
        isExecutable: result.isExecutable,
        regionStart: result.regionStart,
        regionSize: result.regionSize,
        error: result.error,
      };
    } catch (error) {
      logger.error('Memory protection check failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'PowerShell execution failed',
      };
    }
  }

  private buildProtectionCheckScript(pid: number, address: number): string {
    return `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.ComponentModel;

public class ProtectionChecker {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(int access, bool inherit, int pid);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern int VirtualQueryEx(IntPtr hProcess, IntPtr addr, out MEMORY_BASIC_INFORMATION info, int size);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr handle);

    const int PROCESS_QUERY_INFORMATION = 0x0400;

    [StructLayout(LayoutKind.Sequential)]
    public struct MEMORY_BASIC_INFORMATION {
        public IntPtr BaseAddress;
        public IntPtr AllocationBase;
        public uint AllocationProtect;
        public IntPtr RegionSize;
        public uint State;
        public uint Protect;
        public uint Type;
    }

    const uint MEM_COMMIT = 0x1000;
    const uint PAGE_NOACCESS = 0x01;
    const uint PAGE_READONLY = 0x02;
    const uint PAGE_READWRITE = 0x04;
    const uint PAGE_WRITECOPY = 0x08;
    const uint PAGE_EXECUTE = 0x10;
    const uint PAGE_EXECUTE_READ = 0x20;
    const uint PAGE_EXECUTE_READWRITE = 0x40;
    const uint PAGE_EXECUTE_WRITECOPY = 0x80;
    const uint PAGE_GUARD = 0x100;

    public static object CheckProtection(int pid, long address) {
        IntPtr hProcess = OpenProcess(PROCESS_QUERY_INFORMATION, false, pid);
        if (hProcess == IntPtr.Zero) {
            int error = Marshal.GetLastWin32Error();
            throw new Win32Exception(error, "Failed to open process. Run as Administrator.");
        }

        try {
            MEMORY_BASIC_INFORMATION info;
            int infoSize = Marshal.SizeOf(typeof(MEMORY_BASIC_INFORMATION));
            int result = VirtualQueryEx(hProcess, (IntPtr)address, out info, infoSize);

            if (result != infoSize) {
                return new { success = false, error = "Failed to query memory region" };
            }

            if (info.State != MEM_COMMIT) {
                return new {
                    success = true,
                    protection = "NOT_COMMITTED",
                    isWritable = false,
                    isReadable = false,
                    isExecutable = false,
                    regionStart = "0x" + info.BaseAddress.ToInt64().ToString("X"),
                    regionSize = info.RegionSize.ToInt64()
                };
            }

            uint protect = info.Protect;
            string protectionStr = "";
            bool isWritable = false;
            bool isReadable = false;
            bool isExecutable = false;

            if ((protect & PAGE_NOACCESS) != 0) protectionStr += "NOACCESS ";
            if ((protect & PAGE_READONLY) != 0) { protectionStr += "R "; isReadable = true; }
            if ((protect & PAGE_READWRITE) != 0) { protectionStr += "RW "; isReadable = true; isWritable = true; }
            if ((protect & PAGE_WRITECOPY) != 0) { protectionStr += "WC "; isReadable = true; isWritable = true; }
            if ((protect & PAGE_EXECUTE) != 0) { protectionStr += "X "; isExecutable = true; }
            if ((protect & PAGE_EXECUTE_READ) != 0) { protectionStr += "RX "; isReadable = true; isExecutable = true; }
            if ((protect & PAGE_EXECUTE_READWRITE) != 0) { protectionStr += "RWX "; isReadable = true; isWritable = true; isExecutable = true; }
            if ((protect & PAGE_EXECUTE_WRITECOPY) != 0) { protectionStr += "RWCX "; isReadable = true; isWritable = true; isExecutable = true; }
            if ((protect & PAGE_GUARD) != 0) protectionStr += "GUARD ";

            return new {
                success = true,
                protection = protectionStr.Trim(),
                isWritable = isWritable,
                isReadable = isReadable,
                isExecutable = isExecutable,
                regionStart = "0x" + info.BaseAddress.ToInt64().ToString("X"),
                regionSize = info.RegionSize.ToInt64()
            };
        } finally {
            CloseHandle(hProcess);
        }
    }
}
"@

try {
    $result = [ProtectionChecker]::CheckProtection(${pid}, ${address})
    $result | ConvertTo-Json -Compress
} catch {
    @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
    `.trim();
  }

  /**
   * Scan within specific addresses (filtered scan)
   * For secondary scanning within previous results
   */
  async scanMemoryFiltered(
    pid: number,
    pattern: string,
    addresses: string[],
    patternType: 'hex' | 'int32' | 'int64' | 'float' | 'double' | 'string' = 'hex'
  ): Promise<MemoryScanResult> {
    // First convert addresses to validation list
    const validAddresses: number[] = [];
    for (const addr of addresses) {
      const num = parseInt(addr, 16);
      if (!isNaN(num)) validAddresses.push(num);
    }

    if (validAddresses.length === 0) {
      return { success: false, addresses: [], error: 'No valid addresses provided' };
    }

    // For each address, read a window and check if pattern matches
    const results: string[] = [];
    const windowSize = 256; // Read 256 bytes around each address for pattern matching

    for (const addr of validAddresses) {
      // Read from the address
      const readResult = await this.readMemory(pid, `0x${addr.toString(16)}`, windowSize);
      if (readResult.success && readResult.data) {
        // Check if pattern exists in this region
        const matchResult = await this.scanMemory(pid, pattern, patternType);
        if (matchResult.success) {
          // Filter to only addresses in our valid list
          for (const matchAddr of matchResult.addresses) {
            const matchNum = parseInt(matchAddr, 16);
            if (validAddresses.some(a => Math.abs(a - matchNum) < windowSize)) {
              if (!results.includes(matchAddr)) {
                results.push(matchAddr);
              }
            }
          }
        }
      }
    }

    return {
      success: true,
      addresses: results,
      stats: { resultsFound: results.length, patternLength: pattern.length }
    };
  }

  /**
   * Monitor memory address for changes (polling-based)
   * Returns a monitoring session ID
   */
  private activeMonitors: Map<string, { pid: number; address: string; interval: number; lastValue: string; timer: NodeJS.Timeout }> = new Map();

  startMemoryMonitor(
    pid: number,
    address: string,
    size: number = 4,
    intervalMs: number = 1000,
    onChange?: (oldValue: string, newValue: string) => void
  ): string {
    const monitorId = `monitor_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const timer = setInterval(async () => {
      const monitor = this.activeMonitors.get(monitorId);
      if (!monitor) return;

      const result = await this.readMemory(pid, address, size);
      if (result.success && result.data) {
        if (monitor.lastValue !== result.data) {
          if (onChange && monitor.lastValue !== '') {
            onChange(monitor.lastValue, result.data);
          }
          monitor.lastValue = result.data;
        }
      }
    }, intervalMs);

    this.activeMonitors.set(monitorId, {
      pid,
      address,
      interval: intervalMs,
      lastValue: '',
      timer
    });

    return monitorId;
  }

  stopMemoryMonitor(monitorId: string): boolean {
    const monitor = this.activeMonitors.get(monitorId);
    if (monitor) {
      clearInterval(monitor.timer);
      this.activeMonitors.delete(monitorId);
      return true;
    }
    return false;
  }

  /**
   * Batch memory write (NOP sled, patch multiple addresses)
   */
  async batchMemoryWrite(
    pid: number,
    patches: { address: string; data: string; encoding?: 'hex' | 'base64' }[]
  ): Promise<{ success: boolean; results: { address: string; success: boolean; error?: string }[]; error?: string }> {
    const results: { address: string; success: boolean; error?: string }[] = [];

    for (const patch of patches) {
      const result = await this.writeMemory(pid, patch.address, patch.data, patch.encoding || 'hex');
      results.push({
        address: patch.address,
        success: result.success,
        error: result.error
      });
    }

    const allSuccess = results.every(r => r.success);
    return {
      success: allSuccess,
      results,
      error: allSuccess ? undefined : `Failed to write ${results.filter(r => !r.success).length} of ${results.length} patches`
    };
  }

  // ==================== Code Injection ====================

  /**
   * Inject DLL into target process (Windows)
   * Uses CreateRemoteThread + LoadLibraryA
   */
  async injectDll(pid: number, dllPath: string): Promise<{ success: boolean; remoteThreadId?: number; error?: string }> {
    if (this.platform !== 'win32') {
      return { success: false, error: 'DLL injection currently only implemented for Windows' };
    }

    try {
      const psScript = this.buildDllInjectionScript(pid, dllPath);

      const { stdout } = await this.executePowerShellScript(psScript, { maxBuffer: 1024 * 1024, timeout: 30000 }
      );

      const result = JSON.parse(stdout.trim());
      return {
        success: result.success,
        remoteThreadId: result.remoteThreadId,
        error: result.error,
      };
    } catch (error) {
      logger.error('DLL injection failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'PowerShell execution failed',
      };
    }
  }

  private buildDllInjectionScript(pid: number, dllPath: string): string {
    return `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.ComponentModel;
using System.IO;

public class DllInjector {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(int access, bool inherit, int pid);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr VirtualAllocEx(IntPtr hProcess, IntPtr addr, int size, int allocType, int protect);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool WriteProcessMemory(IntPtr hProcess, IntPtr addr, byte[] buffer, int size, out int written);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr CreateRemoteThread(IntPtr hProcess, IntPtr attr, int stackSize, IntPtr startAddr, IntPtr param, int flags, out int threadId);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr GetModuleHandle(string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr GetProcAddress(IntPtr hModule, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool VirtualFreeEx(IntPtr hProcess, IntPtr addr, int size, int freeType);

    const int PROCESS_CREATE_THREAD = 0x0002;
    const int PROCESS_QUERY_INFORMATION = 0x0400;
    const int PROCESS_VM_OPERATION = 0x0008;
    const int PROCESS_VM_WRITE = 0x0020;
    const int MEM_COMMIT = 0x1000;
    const int MEM_RESERVE = 0x2000;
    const int PAGE_READWRITE = 0x04;
    const int MEM_RELEASE = 0x8000;

    public static object Inject(int pid, string dllPath) {
        if (!File.Exists(dllPath)) {
            return new { success = false, error = "DLL not found: " + dllPath };
        }

        IntPtr hProcess = OpenProcess(PROCESS_CREATE_THREAD | PROCESS_QUERY_INFORMATION | PROCESS_VM_OPERATION | PROCESS_VM_WRITE, false, pid);
        if (hProcess == IntPtr.Zero) {
            int error = Marshal.GetLastWin32Error();
            throw new Win32Exception(error, "Failed to open process. Run as Administrator.");
        }

        try {
            byte[] dllBytes = System.Text.Encoding.ASCII.GetBytes(dllPath + "\\0");
            IntPtr remoteMem = VirtualAllocEx(hProcess, IntPtr.Zero, dllBytes.Length, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
            if (remoteMem == IntPtr.Zero) {
                int error = Marshal.GetLastWin32Error();
                throw new Win32Exception(error, "Failed to allocate memory in target");
            }

            try {
                int written;
                if (!WriteProcessMemory(hProcess, remoteMem, dllBytes, dllBytes.Length, out written)) {
                    int error = Marshal.GetLastWin32Error();
                    throw new Win32Exception(error, "Failed to write DLL path to target");
                }

                IntPtr hKernel32 = GetModuleHandle("kernel32.dll");
                IntPtr loadLibraryAddr = GetProcAddress(hKernel32, "LoadLibraryA");
                if (loadLibraryAddr == IntPtr.Zero) {
                    throw new Exception("Failed to get LoadLibraryA address");
                }

                int threadId;
                IntPtr hThread = CreateRemoteThread(hProcess, IntPtr.Zero, 0, loadLibraryAddr, remoteMem, 0, out threadId);
                if (hThread == IntPtr.Zero) {
                    int error = Marshal.GetLastWin32Error();
                    throw new Win32Exception(error, "Failed to create remote thread");
                }

                CloseHandle(hThread);
                return new { success = true, remoteThreadId = threadId };
            } finally {
                VirtualFreeEx(hProcess, remoteMem, 0, MEM_RELEASE);
            }
        } finally {
            CloseHandle(hProcess);
        }
    }
}
"@

try {
    $result = [DllInjector]::Inject(${pid}, "${dllPath.replace(/\\/g, '\\\\')}")
    $result | ConvertTo-Json -Compress
} catch {
    @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
    `.trim();
  }

  /**
   * Inject shellcode into target process (Windows)
   * Uses VirtualAllocEx + WriteProcessMemory + CreateRemoteThread
   */
  async injectShellcode(pid: number, shellcode: string, encoding: 'hex' | 'base64' = 'hex'): Promise<{ success: boolean; remoteThreadId?: number; error?: string }> {
    if (this.platform !== 'win32') {
      return { success: false, error: 'Shellcode injection currently only implemented for Windows' };
    }

    try {
      // Decode shellcode
      let shellcodeBytes: Buffer;
      if (encoding === 'base64') {
        shellcodeBytes = Buffer.from(shellcode, 'base64');
      } else {
        const cleanHex = shellcode.replace(/\s/g, '');
        shellcodeBytes = Buffer.from(cleanHex, 'hex');
      }

      const psScript = this.buildShellcodeInjectionScript(pid, shellcodeBytes);

      const { stdout } = await this.executePowerShellScript(psScript, { maxBuffer: 1024 * 1024, timeout: 30000 }
      );

      const result = JSON.parse(stdout.trim());
      return {
        success: result.success,
        remoteThreadId: result.remoteThreadId,
        error: result.error,
      };
    } catch (error) {
      logger.error('Shellcode injection failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'PowerShell execution failed',
      };
    }
  }

  private buildShellcodeInjectionScript(pid: number, shellcode: Buffer): string {
    return `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.ComponentModel;

public class ShellcodeInjector {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(int access, bool inherit, int pid);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr VirtualAllocEx(IntPtr hProcess, IntPtr addr, int size, int allocType, int protect);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool WriteProcessMemory(IntPtr hProcess, IntPtr addr, byte[] buffer, int size, out int written);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr CreateRemoteThread(IntPtr hProcess, IntPtr attr, int stackSize, IntPtr startAddr, IntPtr param, int flags, out int threadId);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool VirtualProtectEx(IntPtr hProcess, IntPtr addr, int size, int newProtect, out int oldProtect);

    const int PROCESS_CREATE_THREAD = 0x0002;
    const int PROCESS_QUERY_INFORMATION = 0x0400;
    const int PROCESS_VM_OPERATION = 0x0008;
    const int PROCESS_VM_WRITE = 0x0020;
    const int MEM_COMMIT = 0x1000;
    const int MEM_RESERVE = 0x2000;
    const int PAGE_READWRITE = 0x04;
    const int PAGE_EXECUTE_READWRITE = 0x40;

    public static object Inject(int pid, byte[] shellcode) {
        IntPtr hProcess = OpenProcess(PROCESS_CREATE_THREAD | PROCESS_QUERY_INFORMATION | PROCESS_VM_OPERATION | PROCESS_VM_WRITE, false, pid);
        if (hProcess == IntPtr.Zero) {
            int error = Marshal.GetLastWin32Error();
            throw new Win32Exception(error, "Failed to open process. Run as Administrator.");
        }

        try {
            IntPtr remoteMem = VirtualAllocEx(hProcess, IntPtr.Zero, shellcode.Length, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
            if (remoteMem == IntPtr.Zero) {
                int error = Marshal.GetLastWin32Error();
                throw new Win32Exception(error, "Failed to allocate memory in target");
            }

            try {
                int written;
                if (!WriteProcessMemory(hProcess, remoteMem, shellcode, shellcode.Length, out written)) {
                    int error = Marshal.GetLastWin32Error();
                    throw new Win32Exception(error, "Failed to write shellcode to target");
                }

                int oldProtect;
                if (!VirtualProtectEx(hProcess, remoteMem, shellcode.Length, PAGE_EXECUTE_READWRITE, out oldProtect)) {
                    int error = Marshal.GetLastWin32Error();
                    throw new Win32Exception(error, "Failed to change memory protection to executable");
                }

                int threadId;
                IntPtr hThread = CreateRemoteThread(hProcess, IntPtr.Zero, 0, remoteMem, IntPtr.Zero, 0, out threadId);
                if (hThread == IntPtr.Zero) {
                    int error = Marshal.GetLastWin32Error();
                    throw new Win32Exception(error, "Failed to create remote thread");
                }

                CloseHandle(hThread);
                return new { success = true, remoteThreadId = threadId };
            } finally {
                // Note: Memory is not freed to allow shellcode to execute
            }
        } finally {
            CloseHandle(hProcess);
        }
    }
}
"@

try {
    $shellcode = @(${Array.from(shellcode).join(',')})
    $result = [ShellcodeInjector]::Inject(${pid}, $shellcode)
    $result | ConvertTo-Json -Compress
} catch {
    @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
    `.trim();
  }

  // ==================== Anti-Detection / Anti-Anti-Debug ====================

  /**
   * Check for debugger attachment in target process
   * Uses NtQueryInformationProcess with ProcessDebugPort
   */
  async checkDebugPort(pid: number): Promise<{ success: boolean; isDebugged?: boolean; error?: string }> {
    if (this.platform !== 'win32') {
      return { success: false, error: 'Debug port check currently only implemented for Windows' };
    }

    try {
      const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.ComponentModel;

public class DebugChecker {
    [DllImport("ntdll.dll")]
    public static extern int NtQueryInformationProcess(IntPtr processHandle, int processInformationClass, out IntPtr processInformation, int processInformationLength, out int returnLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(int access, bool inherit, int pid);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr handle);

    const int PROCESS_QUERY_INFORMATION = 0x0400;
    const int ProcessDebugPort = 7;

    public static object Check(int pid) {
        IntPtr hProcess = OpenProcess(PROCESS_QUERY_INFORMATION, false, pid);
        if (hProcess == IntPtr.Zero) {
            int error = Marshal.GetLastWin32Error();
            throw new Win32Exception(error, "Failed to open process");
        }

        try {
            IntPtr debugPort;
            int returnLength;
            int status = NtQueryInformationProcess(hProcess, ProcessDebugPort, out debugPort, IntPtr.Size, out returnLength);

            if (status != 0) {
                return new { success = false, error = "NtQueryInformationProcess failed with status: 0x" + status.ToString("X") };
            }

            return new { success = true, isDebugged = debugPort != IntPtr.Zero };
        } finally {
            CloseHandle(hProcess);
        }
    }
}
"@

try {
    $result = [DebugChecker]::Check(${pid})
    $result | ConvertTo-Json -Compress
} catch {
    @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
      `;

      const { stdout } = await this.executePowerShellScript(psScript, { maxBuffer: 1024 * 1024, timeout: 10000 }
      );

      const result = JSON.parse(stdout.trim());
      return result;
    } catch (error) {
      logger.error('Debug port check failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'PowerShell execution failed',
      };
    }
  }

  /**
   * Enumerate loaded modules in target process
   * Useful for finding base addresses
   */
  async enumerateModules(pid: number): Promise<{ success: boolean; modules?: { name: string; baseAddress: string; size: number }[]; error?: string }> {
    if (this.platform !== 'win32') {
      return { success: false, error: 'Module enumeration currently only implemented for Windows' };
    }

    try {
      const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.ComponentModel;

public class ModuleEnumerator {
    [DllImport("psapi.dll", SetLastError = true)]
    public static extern bool EnumProcessModules(IntPtr hProcess, [Out] IntPtr[] lphModule, int cb, out int lpcbNeeded);

    [DllImport("psapi.dll", SetLastError = true)]
    public static extern int GetModuleBaseName(IntPtr hProcess, IntPtr hModule, [Out] System.Text.StringBuilder lpBaseName, int nSize);

    [DllImport("psapi.dll", SetLastError = true)]
    public static extern bool GetModuleInformation(IntPtr hProcess, IntPtr hModule, out MODULEINFO lpmodinfo, int cb);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(int access, bool inherit, int pid);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr handle);

    const int PROCESS_QUERY_INFORMATION = 0x0400;
    const int PROCESS_VM_READ = 0x0010;

    [StructLayout(LayoutKind.Sequential)]
    public struct MODULEINFO {
        public IntPtr lpBaseOfDll;
        public int SizeOfImage;
        public IntPtr EntryPoint;
    }

    public static object Enumerate(int pid) {
        IntPtr hProcess = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, pid);
        if (hProcess == IntPtr.Zero) {
            int error = Marshal.GetLastWin32Error();
            throw new Win32Exception(error, "Failed to open process");
        }

        try {
            IntPtr[] modules = new IntPtr[1024];
            int cbNeeded;

            if (!EnumProcessModules(hProcess, modules, modules.Length * IntPtr.Size, out cbNeeded)) {
                int error = Marshal.GetLastWin32Error();
                throw new Win32Exception(error, "EnumProcessModules failed");
            }

            int numModules = cbNeeded / IntPtr.Size;
            var result = new List<object>();

            for (int i = 0; i < numModules; i++) {
                System.Text.StringBuilder baseName = new System.Text.StringBuilder(256);
                if (GetModuleBaseName(hProcess, modules[i], baseName, baseName.Capacity) > 0) {
                    MODULEINFO modInfo;
                    if (GetModuleInformation(hProcess, modules[i], out modInfo, Marshal.SizeOf(typeof(MODULEINFO)))) {
                        result.Add(new {
                            name = baseName.ToString(),
                            baseAddress = "0x" + modInfo.lpBaseOfDll.ToInt64().ToString("X"),
                            size = modInfo.SizeOfImage
                        });
                    }
                }
            }

            return new { success = true, modules = result };
        } finally {
            CloseHandle(hProcess);
        }
    }
}
"@

try {
    $result = [ModuleEnumerator]::Enumerate(${pid})
    $result | ConvertTo-Json -Compress -Depth 10
} catch {
    @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
      `;

      const { stdout } = await this.executePowerShellScript(psScript, { maxBuffer: 1024 * 1024 * 10, timeout: 30000 }
      );

      const result = JSON.parse(stdout.trim());
      return result;
    } catch (error) {
      logger.error('Module enumeration failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'PowerShell execution failed',
      };
    }
  }

  // ==================== Linux Implementation ====================

  private async readMemoryLinux(pid: number, address: number, size: number): Promise<MemoryReadResult> {
    try {
      // Use dd to read from /proc/pid/mem
      // This requires ptrace attachment or process_vm_readv
      const { stdout } = await execAsync(
        `sudo dd if=/proc/${pid}/mem bs=1 skip=${address} count=${size} 2>/dev/null | xxd -p | tr -d '\\n' || echo ""`,
        { maxBuffer: 1024 * 1024 * 10, timeout: 10000 }
      );

      if (!stdout.trim()) {
        return {
          success: false,
          error: 'Failed to read memory. Requires root privileges or ptrace access.',
        };
      }

      // Format hex with spaces
      const hexData = stdout.trim().match(/.{1,2}/g)?.join(' ') || stdout.trim();

      return {
        success: true,
        data: hexData.toUpperCase(),
      };
    } catch (error) {
      logger.error('Linux memory read failed:', error);
      return {
        success: false,
        error: 'Memory read failed. Run as root or use ptrace.',
      };
    }
  }

  private async writeMemoryLinux(pid: number, address: number, data: Buffer): Promise<MemoryWriteResult> {
    try {
      // Writing to /proc/pid/mem requires careful handling
      // Convert buffer to hex for dd
      const hexData = data.toString('hex');

      // Use printf to write binary data
      const { stderr } = await execAsync(
        `sudo sh -c 'printf "${hexData}" | xxd -r -p | dd of=/proc/${pid}/mem bs=1 seek=${address} conv=notrunc 2>&1' || echo ""`,
        { maxBuffer: 1024 * 1024, timeout: 10000 }
      );

      if (stderr && stderr.includes('error')) {
        return {
          success: false,
          error: 'Memory write failed. Requires root privileges.',
        };
      }

      return {
        success: true,
        bytesWritten: data.length,
      };
    } catch (error) {
      logger.error('Linux memory write failed:', error);
      return {
        success: false,
        error: 'Memory write failed. Run as root.',
      };
    }
  }

  private async scanMemoryLinux(
    _pid: number,
    _pattern: string,
    _patternType: string
  ): Promise<MemoryScanResult> {
    // Use memscan tool if available, or implement with /proc/pid/maps
    return {
      success: false,
      addresses: [],
      error: 'Memory scanning on Linux requires scanning /proc/pid/maps and iterating regions. Use scanmem or GameConqueror for now.',
    };
  }

  // ==================== macOS Implementation ====================

  private async readMemoryMac(_pid: number, _address: number, _size: number): Promise<MemoryReadResult> {
    // macOS requires task_for_pid which needs:
    // 1. Root privileges
    // 2. Code signing with specific entitlements
    // 3. SIP disabled for some operations
    return {
      success: false,
      error: 'macOS memory operations require task_for_pid with root privileges and specific entitlements. Use LLDB or implement with ptrace.',
    };
  }

  private async writeMemoryMac(_pid: number, _address: number, _data: Buffer): Promise<MemoryWriteResult> {
    return {
      success: false,
      error: 'macOS memory operations require task_for_pid with root privileges and specific entitlements.',
    };
  }

  private async scanMemoryMac(
    _pid: number,
    _pattern: string,
    _patternType: string
  ): Promise<MemoryScanResult> {
    return {
      success: false,
      addresses: [],
      error: 'macOS memory scanning requires task_for_pid with root privileges.',
    };
  }

  // ==================== Utility Methods ====================

  private getPowerShellExecutable(): string {
    return process.platform === 'win32' ? 'powershell.exe' : 'powershell';
  }

  private async executePowerShellScript(
    script: string,
    options: { maxBuffer?: number; timeout?: number } = {}
  ): Promise<{ stdout: string; stderr: string }> {
    const encodedCommand = Buffer.from(script, 'utf16le').toString('base64');
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedCommand];
    const { stdout, stderr } = await execFileAsync(this.getPowerShellExecutable(), args, {
      maxBuffer: options.maxBuffer ?? 1024 * 1024,
      timeout: options.timeout,
      windowsHide: true,
    });

    return {
      stdout: String(stdout ?? ''),
      stderr: String(stderr ?? ''),
    };
  }

  private async checkWindowsAvailability(): Promise<{ available: boolean; reason?: string }> {
    const now = Date.now();
    const cachedResult = this.windowsAvailabilityCache;

    if (cachedResult && cachedResult.expiresAt > now) {
      return cachedResult.result;
    }

    const result = await this.runWindowsAdminAvailabilityCheck();
    this.windowsAvailabilityCache = {
      expiresAt: now + this.windowsAvailabilityCacheTtlMs,
      result,
    };

    return result;
  }

  private async runWindowsAdminAvailabilityCheck(): Promise<{ available: boolean; reason?: string }> {
    try {
      const { stdout } = await this.executePowerShellScript(
        '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)',
        { timeout: 5000 }
      );
      const normalizedOutput = stdout.trim().toLowerCase();

      if (normalizedOutput === 'true') {
        return { available: true };
      }

      if (normalizedOutput === 'false') {
        return {
          available: false,
          reason: 'Windows memory operations require Administrator privileges. Please run your terminal/IDE as Administrator and retry.',
        };
      }

      return {
        available: false,
        reason: `PowerShell command execution failed while checking Administrator privileges: unexpected output "${stdout.trim() || '(empty)'}".`,
      };
    } catch (error) {
      return {
        available: false,
        reason: this.getWindowsAvailabilityFailureReason(error),
      };
    }
  }

  private getWindowsAvailabilityFailureReason(error: unknown): string {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const stderr = this.getExecErrorStream(error, 'stderr');
    const combined = `${errorMessage}\n${stderr}`.toLowerCase();

    if (
      combined.includes('enoent') ||
      combined.includes('command not found') ||
      combined.includes('is not recognized as an internal or external command') ||
      (combined.includes('cannot find') && combined.includes('powershell'))
    ) {
      return 'PowerShell is unavailable. Windows memory operations require powershell.exe to verify Administrator privileges.';
    }

    return `PowerShell command execution failed while checking Administrator privileges: ${errorMessage}`;
  }

  private getExecErrorStream(error: unknown, key: 'stderr' | 'stdout'): string {
    if (typeof error !== 'object' || error === null) {
      return '';
    }

    const stream = (error as Record<string, unknown>)[key];
    return typeof stream === 'string' ? stream : '';
  }

  /**
   * Check if memory operations are available on current platform
   */
  async checkAvailability(): Promise<{ available: boolean; reason?: string }> {
    switch (this.platform) {
      case 'win32':
        return this.checkWindowsAvailability();
      case 'linux':
        try {
          // Check if we have CAP_SYS_PTRACE capability or are root
          const { stdout } = await execAsync('id -u', { timeout: 2000 });
          if (stdout.trim() === '0') {
            return { available: true };
          }
          // Check for ptrace capability
          try {
            await execAsync('capsh --print 2>/dev/null | grep -q "cap_sys_ptrace"', { timeout: 2000 });
            return { available: true };
          } catch {
            return {
              available: false,
              reason: 'Linux memory operations require root privileges or CAP_SYS_PTRACE capability. Run with sudo.'
            };
          }
        } catch {
          return { available: false, reason: 'Requires root privileges for /proc/pid/mem access. Run with sudo.' };
        }
      case 'darwin':
        return { available: false, reason: 'macOS memory operations require root and entitlements. Use LLDB or run with sudo.' };
      default:
        return { available: false, reason: `Platform ${this.platform} not supported for memory operations.` };
    }
  }
}
