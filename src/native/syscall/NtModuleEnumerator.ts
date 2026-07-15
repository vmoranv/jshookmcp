/**
 * NtModuleEnumerator — runtime kernel-module enumeration via
 * `NtQuerySystemInformation(SystemModuleInformation)`.
 *
 * Complements SyscallResolver (which does static on-disk ntdll parsing) by
 * listing the modules actually loaded in kernel address space at runtime.
 *
 * Win32-only: ntdll.dll is lazy-loaded via koffi. Two test layers:
 *   - NtModuleEnumerator.test.ts — koffi mocked; validates RTL_PROCESS_MODULES
 *     parsing against a hand-crafted buffer.
 *   - NtModuleEnumerator.runtime.test.ts — real FFI on a Windows host (gated
 *     by JSHOOK_NATIVE_RUNTIME=1). This is what caught the x64 layout bug
 *     (288→296-byte records, Modules[0] @8) that left every imageBase reading
 *     0 on a real host while the mocked test stayed green.
 *
 * Note: SystemModuleInformation (class 11) is generally accessible to
 * administrator-level processes; some other information classes additionally
 * require SeDebugPrivilege.
 */
import koffi from 'koffi';

// ── Constants ────────────────────────────────────────────────────────────────

/** SYSTEM_INFORMATION_CLASS::SystemModuleInformation → RTL_PROCESS_MODULES. */
const SYSTEM_MODULE_INFORMATION = 11;

/** NTSTATUS codes (unsigned; the FFI returns int32, use `>>> 0` to compare). */
const STATUS_SUCCESS = 0x00000000;
const STATUS_INFO_LENGTH_MISMATCH = 0xc0000004;

/**
 * RTL_PROCESS_MODULE_INFORMATION layout on Win x64 (296 bytes total):
 *
 *   offset  size  field
 *   ------  ----  -------------------------------
 *      0      8   ULONG_PTR Section     (pointer-width on x64)
 *      8      8   PVOID     MappedBase
 *     16      8   PVOID     ImageBase
 *     24      4   ULONG     ImageSize
 *     28      4   ULONG     Flags
 *     32      2   USHORT    LoadOrderIndex
 *     34      2   USHORT    InitOrderIndex
 *     36      2   USHORT    LoadCount
 *     38      2   USHORT    OffsetToFileName
 *     40    256   UCHAR     FullPathName[256]
 *
 * RTL_PROCESS_MODULES layout:
 *   offset  size  field
 *   ------  ----  -------------------------------
 *      0      4   ULONG NumberOfModules
 *      4      4   (alignment padding — the record struct is 8-byte aligned
 *                because it holds pointer-width fields, so Modules[0] is @8,
 *                NOT @4. This was the pre-runtime-test bug: parsing assumed
 *                base=4 + 32-bit offsets and read garbage on a real x64 host.)
 *      8   var    RTL_PROCESS_MODULE_INFORMATION Modules[]
 *
 * Verified against a real NtQuerySystemInformation(SystemModuleInformation)
 * buffer on Windows 11 x64 by NtModuleEnumerator.runtime.test.ts: 254 modules,
 * record 0 = ntoskrnl.exe @ ImageBase 0xfffff803'29400000, ImageSize ~16 MB.
 */
const FIRST_RECORD_OFFSET = 8; // ULONG NumberOfModules + 4-byte align padding
const MODULE_RECORD_SIZE = 296;
const IMAGE_BASE_OFFSET = 16;
const IMAGE_SIZE_OFFSET = 24;
const OFFSET_TO_FILENAME = 38;
const FULL_PATH_OFFSET = 40;
const FULL_PATH_SIZE = 256;

// ── Types ────────────────────────────────────────────────────────────────────

export interface KernelModule {
  imageBase: bigint;
  imageSize: number;
  fullPath: string;
  shortName: string;
}

// ── FFI lazy loaders (mirror DirectNtApi conventions) ────────────────────────

let _ntdll: ReturnType<typeof koffi.load> | null = null;
function ntdll(): ReturnType<typeof koffi.load> {
  if (!_ntdll) _ntdll = koffi.load('ntdll.dll');
  return _ntdll;
}

let _NtQuerySystemInformation: ReturnType<ReturnType<typeof koffi.load>['func']> | null = null;
function getNtQSI() {
  if (!_NtQuerySystemInformation) {
    // NTSTATUS NtQuerySystemInformation(
    //   SYSTEM_INFORMATION_CLASS infoClass,
    //   PVOID                    buf,
    //   ULONG                    len,
    //   PULONG                   returnLen);
    _NtQuerySystemInformation = ntdll().func(
      'int32 NtQuerySystemInformation(uint32, void *, uint32, uint32 *)',
    );
  }
  return _NtQuerySystemInformation;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const NTSTATUS_MESSAGES: Record<number, string> = {
  0x00000000: 'STATUS_SUCCESS',
  0xc0000004: 'STATUS_INFO_LENGTH_MISMATCH',
  0xc0000023: 'STATUS_BUFFER_TOO_SMALL',
  0xc0000005: 'STATUS_ACCESS_VIOLATION',
  0xc0000022: 'STATUS_ACCESS_DENIED',
  0xc000000d: 'STATUS_INVALID_PARAMETER',
  0xc0000017: 'STATUS_NO_MEMORY',
  0xc0000142: 'STATUS_DLL_INIT_FAILED',
};

function formatNtStatus(status: number): string {
  const u = status >>> 0;
  const hex = `0x${u.toString(16).padStart(8, '0')}`;
  return `${hex} (${NTSTATUS_MESSAGES[u] ?? 'UNKNOWN'})`;
}

function parseModules(buf: Buffer): KernelModule[] {
  const count = buf.readUInt32LE(0);
  const modules: KernelModule[] = [];
  for (let i = 0; i < count; i++) {
    const base = FIRST_RECORD_OFFSET + i * MODULE_RECORD_SIZE;
    if (base + MODULE_RECORD_SIZE > buf.length) break;

    const imageBase = buf.readBigUInt64LE(base + IMAGE_BASE_OFFSET);
    const imageSize = buf.readUInt32LE(base + IMAGE_SIZE_OFFSET);
    const offsetToFileName = buf.readUInt16LE(base + OFFSET_TO_FILENAME);

    const pathStart = base + FULL_PATH_OFFSET;
    const pathBuf = buf.subarray(pathStart, pathStart + FULL_PATH_SIZE);
    const pathNul = pathBuf.indexOf(0);
    const fullPath = (pathNul >= 0 ? pathBuf.subarray(0, pathNul) : pathBuf).toString('ascii');

    let shortName = '';
    if (offsetToFileName > 0 && offsetToFileName < FULL_PATH_SIZE) {
      const nameBuf = pathBuf.subarray(offsetToFileName);
      const nameNul = nameBuf.indexOf(0);
      shortName = (nameNul >= 0 ? nameBuf.subarray(0, nameNul) : nameBuf).toString('ascii');
    }

    modules.push({ imageBase, imageSize, fullPath, shortName });
  }
  return modules;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Enumerate loaded kernel modules via NtQuerySystemInformation.
 * First probes with a small buffer (STATUS_INFO_LENGTH_MISMATCH → required
 * length), then allocates the exact length and queries again. Throws on
 * non-Windows hosts or unexpected NTSTATUS values.
 */
export function enumerateKernelModules(): KernelModule[] {
  if (process.platform !== 'win32') {
    throw new Error('NtQuerySystemInformation module enumeration is Windows-only');
  }

  const fn = getNtQSI();

  // First call: probe with a small buffer to learn the required length.
  const probe = Buffer.alloc(16);
  const returnLen = Buffer.alloc(4);
  let status = fn(
    SYSTEM_MODULE_INFORMATION,
    koffi.address(probe),
    probe.length,
    koffi.address(returnLen),
  ) as number;

  if (status >>> 0 !== STATUS_INFO_LENGTH_MISMATCH && status >>> 0 !== STATUS_SUCCESS) {
    throw new Error(`NtQuerySystemInformation probe failed: ${formatNtStatus(status)}`);
  }

  const required = returnLen.readUInt32LE(0);
  if (required === 0) {
    return [];
  }

  // Second call: allocate the required length and fetch the data.
  const data = Buffer.alloc(required);
  returnLen.writeUInt32LE(0, 0);
  status = fn(
    SYSTEM_MODULE_INFORMATION,
    koffi.address(data),
    data.length,
    koffi.address(returnLen),
  ) as number;

  if (status >>> 0 !== STATUS_SUCCESS) {
    throw new Error(`NtQuerySystemInformation query failed: ${formatNtStatus(status)}`);
  }

  return parseModules(data);
}

/**
 * Find the first kernel module whose short name contains `name` (case-insensitive
 * substring match). Returns null if no module matches.
 * Example: findKernelModule('ntoskrnl') → the ntoskrnl.exe module record.
 */
export function findKernelModule(name: string): KernelModule | null {
  const needle = name.toLowerCase();
  const modules = enumerateKernelModules();
  return modules.find((m) => m.shortName.toLowerCase().includes(needle)) ?? null;
}
