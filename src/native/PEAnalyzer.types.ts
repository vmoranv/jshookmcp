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
  /** Hook mechanism type */
  hookType: 'jmp_rel32' | 'jmp_abs64' | 'push_ret' | 'unknown';
  /** Where the hook redirects (hex) */
  jumpTarget: string;
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
