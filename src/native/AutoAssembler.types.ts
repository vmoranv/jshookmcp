/**
 * Auto Assembler — CE-style AA scripting engine types.
 *
 * @module AutoAssembler.types
 */

/** A parsed AA command ready for execution. */
export interface AAParsedCommand {
  /** Command name (uppercased): ALLOC, DEALLOC, AOBSCAN, etc. */
  command: string;
  /** Raw arguments string (content between parentheses). */
  rawArgs: string;
  /** 1-based line number in the original script. */
  line: number;
}

/** Execution context provided by the host (handler layer). */
export interface AAExecutionContext {
  pid: number;
  allocate: (size: number) => Promise<bigint>;
  free: (address: bigint) => Promise<boolean>;
  protect: (address: bigint, size: number, protection: number) => Promise<void>;
  read: (address: bigint, size: number) => Promise<Buffer>;
  write: (address: bigint, data: Buffer) => Promise<void>;
  aobScan: (pattern: string) => Promise<bigint[]>;
  createThread: (address: bigint) => Promise<void>;
}

/** Per-command execution result. */
export interface AACommandResult {
  command: string;
  line: number;
  success: boolean;
  message: string;
  detail?: Record<string, unknown>;
}

/** Overall script execution result. */
export interface AAExecuteResult {
  success: boolean;
  enableResults: AACommandResult[];
  disableScript: AADisableScript;
  /** Allocations made during ENABLE (name -> address hex). */
  allocations: Record<string, string>;
  /** Symbols registered during ENABLE. */
  symbols: Record<string, string>;
  /** Labels defined during ENABLE. */
  labels: Record<string, string>;
}

/** Serialisable disable script — captures state needed for DISABLE section. */
export interface AADisableScript {
  pid: number;
  disableCommands: AAParsedCommand[];
  allocations: Record<string, string>;
  symbols: Record<string, string>;
  labels: Record<string, string>;
}

/** Safety limits. */
export const AA_LIMITS = {
  /** Maximum number of allocations. */
  MAX_ALLOCATIONS: 100,
  /** Maximum WRITEMEM bytes per command. */
  MAX_WRITEMEM_SIZE: 4096,
  /** Maximum READMEM bytes per command. */
  MAX_READMEM_SIZE: 65536,
  /** Maximum ALLOC size. */
  MAX_ALLOC_SIZE: 1024 * 1024 * 100, // 100MB
  /** Maximum AOBSCAN pattern length (characters). */
  MAX_AOB_PATTERN_LENGTH: 4096,
  /** Maximum number of commands per script. */
  MAX_COMMANDS: 500,
} as const;

/** Protection constants for FULLACCESS. */
export const AA_PROTECTION = {
  RWX: 0x40, // PAGE_EXECUTE_READWRITE
} as const;
