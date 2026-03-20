/**
 * Pointer Chain Engine types.
 *
 * @module PointerChainEngine.types
 */

export interface PointerChainLink {
  /** Address where the pointer was found */
  address: string;
  /** Module name if address is within a module (e.g. "game.exe") */
  module?: string;
  /** Offset from module base */
  moduleOffset?: number;
  /** Offset applied to the dereferenced value to reach next link */
  offset: number;
}

export interface PointerChain {
  /** Unique chain identifier */
  id: string;
  /** Full chain from base to target */
  links: PointerChainLink[];
  /** Final target address this chain resolves to */
  targetAddress: string;
  /** Base address (first link) */
  baseAddress: string;
  /** Whether this chain uses a static base (module-relative) */
  isStatic: boolean;
  /** Number of levels */
  depth: number;
  /** Last validation timestamp */
  lastValidated: number;
  /** Whether the chain is currently valid */
  isValid: boolean;
}

export interface PointerScanOptions {
  /** Maximum pointer chain depth (default: 4, max: 6) */
  maxDepth?: number;
  /** Maximum offset from target at each level (default: 4096) */
  maxOffset?: number;
  /** Only use module-backed memory as base (static pointers only) */
  staticOnly?: boolean;
  /** Maximum number of chains to return (default: 1000) */
  maxResults?: number;
  /** Only scan specific modules (by name) */
  modules?: string[];
  /** Alignment for pointer values (default: 8 on x64) */
  alignment?: number;
}

export interface PointerScanResult {
  pid: number;
  targetAddress: string;
  chains: PointerChain[];
  totalFound: number;
  maxDepth: number;
  elapsed: string;
}

export interface ChainValidationResult {
  chainId: string;
  isValid: boolean;
  resolvedAddress: string | null;
  expectedAddress: string;
  /** Level index where chain breaks (0-based) */
  brokenAt?: number;
}
