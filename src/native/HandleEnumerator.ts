/**
 * Win32 Handle Enumerator — koffi FFI bindings for process handle enumeration.
 *
 * Uses NtQuerySystemInformation(SystemExtendedHandleInformation) to enumerate
 * all open handles in the system, then filters by target PID.
 *
 * Provides:
 *   - enumerateProcessHandles(pid, opts) — main entry point
 *   - buildTypeIndexCache() — maps ObjectTypeIndex → type name
 *   - queryHandleTypeName() / queryHandleObjectName() — NtQueryObject wrappers
 *
 * @module HandleEnumerator
 */

import koffi, { type LibraryHandle } from 'koffi';
import { logger } from '@utils/logger';
import { OpenProcess, CloseHandle, isWindows, PROCESS_ACCESS } from './Win32API';

// ── Constants ──

/** NtQuerySystemInformation information class for extended handle info */
const SystemExtendedHandleInformation = 0x40;

/** NtQueryObject information classes */
const ObjectNameInformation = 1;
const ObjectTypeInformation = 2;

/** NTSTATUS codes */
const STATUS_INFO_LENGTH_MISMATCH = 0xc0000004;
const STATUS_ACCESS_DENIED = 0xc0000022;

/** DuplicateHandle options */
const DUPLICATE_SAME_ACCESS = 0x00000002;

/** GetCurrentProcess pseudo-handle */
const CURRENT_PROCESS = BigInt('0xffffffffffffffff');

/**
 * Handle types where NtQueryObject(ObjectNameInformation) is known to hang
 * because they may have pending synchronous I/O.
 * We skip querying names for these types to avoid indefinite blocking.
 */
const HANG_PRONE_TYPES = new Set([
  'File',
  'EtwRegistration',
  'IoCompletionReserve',
  'WaitCompletionPacket',
  'IoCompletion',
]);

/** SYSTEM_HANDLE_TABLE_ENTRY_INFO_EX size on x64 (40 bytes) */
const ENTRY_SIZE_EX = 40;

/** Header size before entries: NumberOfHandles(8) + Reserved(8) */
const HEADER_SIZE_EX = 16;

/** Maximum buffer size for handle enumeration (512 MB) */
const MAX_BUFFER_SIZE = 0x20000000;

// ── Types ──

export interface RawHandleEntry {
  object: bigint;
  processId: number;
  handleValue: number;
  grantedAccess: number;
  objectTypeIndex: number;
  handleAttributes: number;
}

export interface ResolvedHandleEntry extends RawHandleEntry {
  typeName: string;
  objectName: string;
}

export interface EnumerateOptions {
  /** Include object name resolution (slower, skips hang-prone types). Default: true */
  includeNames?: boolean;
  /** Filter by type name (e.g. 'Process', 'Thread', 'Token'). Default: all types */
  filterType?: string;
}

export interface EnumerateResult {
  success: boolean;
  entries: ResolvedHandleEntry[];
  totalSystemHandles: number;
  typeIndexCache: Map<number, string>;
  error?: string;
  requiresElevation?: boolean;
}

// ── Library Loading ──

let kernel32: LibraryHandle | null = null;
let ntdll: LibraryHandle | null = null;

function getKernel32(): LibraryHandle {
  if (!kernel32) {
    kernel32 = koffi.load('kernel32.dll');
  }
  return kernel32;
}

function getNtdll(): LibraryHandle {
  if (!ntdll) {
    ntdll = koffi.load('ntdll.dll');
  }
  return ntdll;
}

// ── FFI Function Accessors (lazy) ──

let _NtQuerySystemInformation: ReturnType<ReturnType<typeof koffi.load>['func']> | null = null;
function getNtQuerySystemInformation() {
  if (!_NtQuerySystemInformation) {
    _NtQuerySystemInformation = getNtdll().func(
      'int32 NtQuerySystemInformation(uint32, _Out_ void *, uint32, _Out_ uint32 *)',
    );
  }
  return _NtQuerySystemInformation;
}

let _NtQueryObject: ReturnType<ReturnType<typeof koffi.load>['func']> | null = null;
function getNtQueryObject() {
  if (!_NtQueryObject) {
    _NtQueryObject = getNtdll().func(
      'int32 NtQueryObject(void *, uint32, _Out_ void *, uint32, _Out_ uint32 *)',
    );
  }
  return _NtQueryObject;
}

let _DuplicateHandle: ReturnType<ReturnType<typeof koffi.load>['func']> | null = null;
function getDuplicateHandle() {
  if (!_DuplicateHandle) {
    _DuplicateHandle = getKernel32().func(
      'int DuplicateHandle(void *, void *, void *, _Out_ void **, uint32, int, uint32)',
    );
  }
  return _DuplicateHandle;
}

// ── Core Functions ──

/**
 * Query all system handles using NtQuerySystemInformation(SystemExtendedHandleInformation).
 * Uses the STATUS_INFO_LENGTH_MISMATCH retry pattern for variable-length output.
 *
 * @returns Buffer containing SYSTEM_HANDLE_INFORMATION_EX
 */
function querySystemHandleBuffer(): { buffer: Buffer; totalHandles: number } {
  let bufSize = 0x100000; // 1 MB initial
  let buf: Buffer;
  let status: number;

  do {
    buf = Buffer.alloc(bufSize);
    const returnLen = Buffer.alloc(8); // Use 8 bytes for safety

    status = getNtQuerySystemInformation()(
      SystemExtendedHandleInformation,
      koffi.address(buf),
      bufSize,
      koffi.address(returnLen),
    ) as number;

    const unsignedStatus = status >>> 0;
    if (unsignedStatus === STATUS_INFO_LENGTH_MISMATCH) {
      const needed = returnLen.readUInt32LE(0);
      bufSize = needed > 0 ? needed * 2 : bufSize * 2;
      if (bufSize > MAX_BUFFER_SIZE) {
        throw new Error('Handle enumeration buffer exceeded 512 MB');
      }
    } else if (unsignedStatus === STATUS_ACCESS_DENIED) {
      throw new HandleElevationError(
        'NtQuerySystemInformation(SystemExtendedHandleInformation) requires elevated privileges (SeDebugPrivilege). Run as Administrator.',
      );
    } else if (status < 0) {
      throw new Error(
        `NtQuerySystemInformation failed with NTSTATUS 0x${unsignedStatus.toString(16)}`,
      );
    }
  } while (status >>> 0 === STATUS_INFO_LENGTH_MISMATCH);

  const totalHandles = Number(buf.readBigUInt64LE(0));
  return { buffer: buf, totalHandles };
}

/**
 * Parse SYSTEM_HANDLE_INFORMATION_EX buffer into raw handle entries.
 * Filters by process ID if specified.
 */
function parseHandleBuffer(buffer: Buffer, filterPid?: number): RawHandleEntry[] {
  const totalHandles = Number(buffer.readBigUInt64LE(0));
  const entries: RawHandleEntry[] = [];

  for (let i = 0; i < totalHandles; i++) {
    const off = HEADER_SIZE_EX + i * ENTRY_SIZE_EX;
    if (off + ENTRY_SIZE_EX > buffer.length) break;

    const processId = Number(buffer.readBigUInt64LE(off + 8));
    const handleValue = Number(buffer.readBigUInt64LE(off + 16));
    const objectTypeIndex = buffer.readUInt16LE(off + 30);

    // Skip if filtering by PID and this doesn't match
    if (filterPid !== undefined && processId !== filterPid) continue;

    // Skip zero entries (unused handle table slots)
    if (handleValue === 0) continue;

    entries.push({
      object: buffer.readBigUInt64LE(off + 0),
      processId,
      handleValue,
      grantedAccess: buffer.readUInt32LE(off + 24),
      objectTypeIndex,
      handleAttributes: buffer.readUInt32LE(off + 32),
    });
  }

  return entries;
}

/**
 * Query the type name of a handle using NtQueryObject(ObjectTypeInformation).
 * This call never hangs — it is safe to call on any handle type.
 */
function queryHandleTypeName(dupHandle: bigint): string {
  const bufSize = 1024;
  const buf = Buffer.alloc(bufSize);
  const returnLen = Buffer.alloc(8);

  const status = getNtQueryObject()(
    dupHandle,
    ObjectTypeInformation,
    koffi.address(buf),
    bufSize,
    koffi.address(returnLen),
  ) as number;

  if (status < 0) return 'Unknown';

  // UNICODE_STRING at offset 0: Length(uint16) + MaximumLength(uint16) + pad(4) + Buffer(uint64)
  const strLen = buf.readUInt16LE(0);
  if (strLen === 0) return 'Unknown';

  // String data follows the UNICODE_STRING header (offset 16 on x64)
  try {
    return buf.toString('utf16le', 16, 16 + strLen);
  } catch {
    return 'Unknown';
  }
}

/**
 * Query the object name of a handle using NtQueryObject(ObjectNameInformation).
 *
 * WARNING: This call can hang on certain handle types (File, EtwRegistration, etc.)
 * that have pending synchronous I/O. Callers MUST check HANG_PRONE_TYPES before
 * calling this function.
 */
function queryHandleObjectName(dupHandle: bigint): string {
  let bufSize = 4096;
  let buf: Buffer;
  let status: number;

  do {
    buf = Buffer.alloc(bufSize);
    const returnLen = Buffer.alloc(8);

    status = getNtQueryObject()(
      dupHandle,
      ObjectNameInformation,
      koffi.address(buf),
      bufSize,
      koffi.address(returnLen),
    ) as number;

    const unsignedStatus = status >>> 0;
    if (unsignedStatus === STATUS_INFO_LENGTH_MISMATCH) {
      const needed = returnLen.readUInt32LE(0);
      bufSize = needed > 0 ? needed + 256 : bufSize * 2;
      if (bufSize > 0x100000) break; // 1 MB cap for object names
    } else if (status < 0) {
      return '';
    }
  } while (status >>> 0 === STATUS_INFO_LENGTH_MISMATCH);

  if (status < 0) return '';

  const strLen = buf.readUInt16LE(0);
  if (strLen === 0) return '';

  try {
    return buf.toString('utf16le', 16, 16 + strLen);
  } catch {
    return '';
  }
}

/**
 * Duplicate a handle from the source process into the current process.
 * Returns the duplicated handle value, or 0n on failure.
 * The caller MUST close the duplicated handle when done.
 */
function duplicateHandle(sourceProcessHandle: bigint, sourceHandleValue: number): bigint {
  const targetBuf = Buffer.alloc(8);

  const result = getDuplicateHandle()(
    sourceProcessHandle,
    BigInt(sourceHandleValue),
    CURRENT_PROCESS,
    koffi.address(targetBuf),
    0, // desiredAccess (ignored with DUPLICATE_SAME_ACCESS)
    0, // inheritHandle = FALSE
    DUPLICATE_SAME_ACCESS,
  );

  if (result === 0) return 0n;
  return targetBuf.readBigUInt64LE(0);
}

// ── Custom Error ──

/**
 * Build type index cache from entries of the SAME process.
 * Each entry already belongs to the process we have a handle to.
 */
function buildTypeIndexCacheFromProcess(
  processEntries: RawHandleEntry[],
  processHandle: bigint,
): Map<number, string> {
  const cache = new Map<number, string>();
  const seenIndices = new Set<number>();

  for (const entry of processEntries) {
    if (seenIndices.has(entry.objectTypeIndex)) continue;
    seenIndices.add(entry.objectTypeIndex);

    const dupHandle = duplicateHandle(processHandle, entry.handleValue);
    if (dupHandle === 0n) continue;

    try {
      const typeName = queryHandleTypeName(dupHandle);
      cache.set(entry.objectTypeIndex, typeName);
    } finally {
      CloseHandle(dupHandle);
    }
  }

  return cache;
}

// ── Custom Error ──

export class HandleElevationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HandleElevationError';
  }
}

// ── Public API ──

/**
 * Enumerate all handles for a specific process.
 *
 * This is the main entry point called by the process domain handler.
 * It:
 *   1. Queries all system handles via NtQuerySystemInformation
 *   2. Filters by target PID
 *   3. Opens the target process for PROCESS_DUP_HANDLE
 *   4. Builds ObjectTypeIndex → type name cache
 *   5. Resolves object names (if requested, skipping hang-prone types)
 *   6. Returns resolved entries with optional type filtering
 *
 * @param pid Target process ID
 * @param opts Enumeration options
 * @returns Enumeration result with resolved handles
 */
export function enumerateProcessHandles(pid: number, opts: EnumerateOptions = {}): EnumerateResult {
  if (!isWindows()) {
    return {
      success: false,
      entries: [],
      totalSystemHandles: 0,
      typeIndexCache: new Map(),
      error: 'process_enum_handles is only available on Windows',
    };
  }

  const includeNames = opts.includeNames !== false;
  const filterType = opts.filterType?.toLowerCase();

  try {
    // 1. Query all system handles
    const { buffer, totalHandles } = querySystemHandleBuffer();

    // 2. Filter by target PID
    const rawEntries = parseHandleBuffer(buffer, pid);

    // 3. Open target process for DUP_HANDLE access
    let processHandle: bigint;
    try {
      processHandle = OpenProcess(PROCESS_ACCESS.DUP_HANDLE, false, pid);
    } catch {
      // Try with QUERY_LIMITED_INFORMATION as fallback
      try {
        processHandle = OpenProcess(PROCESS_ACCESS.QUERY_LIMITED_INFORMATION, false, pid);
      } catch {
        return {
          success: false,
          entries: [],
          totalSystemHandles: totalHandles,
          typeIndexCache: new Map(),
          error: `Cannot open process ${pid}. Run as Administrator.`,
          requiresElevation: true,
        };
      }
    }

    try {
      // 4. Build type index cache
      const typeIndexCache = buildTypeIndexCacheFromProcess(rawEntries, processHandle);

      // 5. Resolve handles
      const resolved: ResolvedHandleEntry[] = [];

      for (const entry of rawEntries) {
        const typeName = typeIndexCache.get(entry.objectTypeIndex) ?? 'Unknown';

        // Apply type filter early to avoid unnecessary name resolution
        if (filterType && typeName.toLowerCase() !== filterType) continue;

        let objectName = '';
        if (includeNames && !HANG_PRONE_TYPES.has(typeName)) {
          const dupHandle = duplicateHandle(processHandle, entry.handleValue);
          if (dupHandle !== 0n) {
            try {
              objectName = queryHandleObjectName(dupHandle);
            } finally {
              CloseHandle(dupHandle);
            }
          }
        }

        resolved.push({
          ...entry,
          typeName,
          objectName,
        });
      }

      return {
        success: true,
        entries: resolved,
        totalSystemHandles: totalHandles,
        typeIndexCache,
      };
    } finally {
      CloseHandle(processHandle);
    }
  } catch (error) {
    if (error instanceof HandleElevationError) {
      return {
        success: false,
        entries: [],
        totalSystemHandles: 0,
        typeIndexCache: new Map(),
        error: error.message,
        requiresElevation: true,
      };
    }

    return {
      success: false,
      entries: [],
      totalSystemHandles: 0,
      typeIndexCache: new Map(),
      error: `Handle enumeration failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Build type index cache from an existing buffer.
 * Useful for testing — avoids FFI calls.
 */
export function parseHandleBufferForTest(buffer: Buffer, filterPid?: number): RawHandleEntry[] {
  return parseHandleBuffer(buffer, filterPid);
}

// ── Cleanup ──

/**
 * Unload all loaded libraries
 */
export function unloadHandleEnumerator(): void {
  if (kernel32) {
    kernel32.unload();
    kernel32 = null;
  }
  if (ntdll) {
    ntdll.unload();
    ntdll = null;
  }
  _NtQuerySystemInformation = null;
  _NtQueryObject = null;
  _DuplicateHandle = null;
  logger.debug('Unloaded HandleEnumerator native libraries');
}
