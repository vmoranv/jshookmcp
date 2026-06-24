/**
 * PEAnalyzer type definitions.
 * @module PEAnalyzer.types
 */

/** Parsed PE DOS + NT headers */
export interface PEHeaders {
  dosHeader: {
    /** Must be 0x5A4D ('MZ') */
    e_magic: number;
    /** File offset to NT headers */
    e_lfanew: number;
  };
  /** Must be 0x00004550 ('PE\0\0') */
  ntSignature: number;
  fileHeader: {
    /** Machine type (0x8664 = x64, 0x014C = x86) */
    machine: number;
    numberOfSections: number;
    timeDateStamp: number;
    characteristics: number;
  };
  optionalHeader: {
    /** 0x10B = PE32, 0x20B = PE32+ */
    magic: number;
    /** Image base address (hex) */
    imageBase: string;
    /** Entry point RVA (hex) */
    entryPoint: string;
    sizeOfImage: number;
    numberOfRvaAndSizes: number;
  };
}

/** PE section header */
export interface PESection {
  /** Section name (e.g. '.text', '.rdata') */
  name: string;
  /** Virtual address (hex) */
  virtualAddress: string;
  /** Virtual size */
  virtualSize: number;
  /** Raw data size */
  rawSize: number;
  /** Section characteristics flags */
  characteristics: number;
  isExecutable: boolean;
  isWritable: boolean;
  isReadable: boolean;
}

/** Imported DLL and its functions */
export interface ImportEntry {
  dllName: string;
  functions: ImportFunction[];
}

/** Single imported function */
export interface ImportFunction {
  name: string;
  ordinal: number;
  hint: number;
  /** Import Address Table RVA (hex) */
  thunkRva: string;
}

/** Single exported function */
export interface ExportEntry {
  name: string;
  ordinal: number;
  /** Relative Virtual Address (hex) */
  rva: string;
  /** If forwarded, the target (e.g. 'NTDLL.RtlAllocateHeap') */
  forwardedTo: string | null;
}

/** Detected inline hook */
export interface InlineHookDetection {
  /** Address of the hooked function (hex) */
  address: string;
  /** Module containing the hook target */
  moduleName: string;
  /** Function name that was hooked */
  functionName: string;
  /** Original bytes from disk */
  originalBytes: number[];
  /** Current bytes in memory */
  currentBytes: number[];
  /** Hook mechanism type.
   *
   * Covers the 8 hook patterns recognised by pe-sieve's PatchAnalyzer
   * (https://github.com/hasherezade/pe-sieve/wiki) plus two non-hook
   * modification classes. `jmp_rel32`/`jmp_abs64`/`push_ret` are the legacy
   * set; `call_rel32`/`short_jmp`/`mov_jmp`/`mov_call` were added to close
   * the detection gap (MOV+JMP in particular is a common modern hook that the
   * old 3-pattern classifier silently missed). `int3_breakpoint`/`padding`
   * classify non-hook modifications (debug breakpoints, NOP sleds). */
  hookType:
    | 'jmp_rel32'
    | 'call_rel32'
    | 'short_jmp'
    | 'jmp_abs64'
    | 'mov_jmp'
    | 'mov_call'
    | 'push_ret'
    | 'int3_breakpoint'
    | 'padding'
    | 'unknown';
  /** Where the hook redirects (hex) */
  jumpTarget: string;
}

/** Detected IAT (Import Address Table) hook.
 *
 * An IAT hook redirects an imported function pointer to an alternate address.
 * Unlike inline hooks, the function body is untouched — only the IAT entry is
 * overwritten. This is the detection pioneered by pe-sieve's IAT scan mode
 * (https://github.com/hasherezade/pe-sieve/wiki/4.7.-Scan-for-IAT-Hooks-(iat)):
 * each IAT entry's resolved address is checked against the declared source
 * module's address range; entries pointing outside that range are flagged.
 *
 * Note: legitimate forwarded exports can also point outside the source module,
 * so detections include `actualModule` for operator triage. */
export interface IATHookDetection {
  /** Module whose IAT entry was redirected */
  moduleName: string;
  /** DLL the function was imported from (declared source) */
  importDll: string;
  /** Imported function name (or 'Ordinal#N') */
  functionName: string;
  /** IAT entry address (hex) — the pointer that was overwritten */
  iatAddress: string;
  /** Expected source module name (where the import should resolve) */
  expectedModule: string;
  /** Address the IAT entry actually points to (hex) */
  actualTarget: string;
  /** Module containing the actual target, if identifiable within loaded modules */
  actualModule: string | null;
}

/** Section anomaly */
export interface SectionAnomaly {
  sectionName: string;
  anomalyType: 'rwx' | 'writable_code' | 'executable_data' | 'high_entropy' | 'name_mismatch';
  severity: 'low' | 'medium' | 'high';
  details: string;
}

/** PE section characteristic flags */
export const IMAGE_SCN = {
  CNT_CODE: 0x00000020,
  CNT_INITIALIZED_DATA: 0x00000040,
  CNT_UNINITIALIZED_DATA: 0x00000080,
  MEM_EXECUTE: 0x20000000,
  MEM_READ: 0x40000000,
  MEM_WRITE: 0x80000000,
} as const;

/** Data directory indices */
export const IMAGE_DIRECTORY_ENTRY = {
  EXPORT: 0,
  IMPORT: 1,
  RESOURCE: 2,
  EXCEPTION: 3,
  IAT: 12,
  DELAY_IMPORT: 13,
} as const;
