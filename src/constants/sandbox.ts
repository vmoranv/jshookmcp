/**
 * Sandbox execution, JSVMP deobfuscation, symbolic execution.
 * Prefixes: SANDBOX_*, JSVMP_*, SYMBOLIC_*, PACKER_*
 */

import { bool, int } from './helpers.js';

/* ================================================================== */
/*  Sandbox execution                                                  */
/* ================================================================== */

export const SANDBOX_EXEC_TIMEOUT_MS = int('SANDBOX_EXEC_TIMEOUT_MS', 5_000);
export const SANDBOX_MEMORY_LIMIT_MB = int('SANDBOX_MEMORY_LIMIT_MB', 128);
export const SANDBOX_STACK_SIZE_MB = int('SANDBOX_STACK_SIZE_MB', 4);
export const SANDBOX_TERMINATE_GRACE_MS = int('SANDBOX_TERMINATE_GRACE_MS', 2_000);

/** Hard ceiling applied to user-supplied sandbox exec timeouts. */
export const SANDBOX_MAX_TIMEOUT_MS = int('SANDBOX_MAX_TIMEOUT_MS', 30_000);

/* ================================================================== */
/*  Symbolic execution                                                 */
/* ================================================================== */

export const SYMBOLIC_EXEC_MAX_PATHS = int('SYMBOLIC_EXEC_MAX_PATHS', 100);
export const SYMBOLIC_EXEC_MAX_DEPTH = int('SYMBOLIC_EXEC_MAX_DEPTH', 50);
export const SYMBOLIC_EXEC_TIMEOUT_MS = int('SYMBOLIC_EXEC_TIMEOUT_MS', 30_000);

/* ================================================================== */
/*  JSVMP deobfuscation                                                */
/* ================================================================== */

export const JSVMP_DEOBFUSCATE_TIMEOUT_MS = int('JSVMP_DEOBFUSCATE_TIMEOUT_MS', 30_000);
export const JSVMP_MAX_ITERATIONS = int('JSVMP_MAX_ITERATIONS', 100);
export const JSVMP_SYMBOLIC_MAX_STEPS = int('JSVMP_SYMBOLIC_MAX_STEPS', 1_000);
export const JSVMP_SYMBOLIC_TIMEOUT_MS = int('JSVMP_SYMBOLIC_TIMEOUT_MS', 30_000);

/* ================================================================== */
/*  Z3 SMT solver                                                      */
/* ================================================================== */

/**
 * Master switch for the Z3 SMT solver integration.
 * When disabled (or when the WASM module fails to initialize), callers
 * fall back to their legacy solvers (greedy ROP heuristics / regex SMT).
 *
 * @env Z3_ENABLED
 * @default true
 */
export const Z3_ENABLED = bool('Z3_ENABLED', true);

/**
 * Timeout for the one-time Z3 WASM `init()` call.
 *
 * @env Z3_INIT_TIMEOUT_MS
 * @default 5000
 */
export const Z3_INIT_TIMEOUT_MS = int('Z3_INIT_TIMEOUT_MS', 5_000);

/**
 * Default per-solve timeout passed to `solver.set('timeout', N)`.
 * Individual callers may override.
 *
 * @env Z3_SOLVE_TIMEOUT_MS
 * @default 10000
 */
export const Z3_SOLVE_TIMEOUT_MS = int('Z3_SOLVE_TIMEOUT_MS', 10_000);

/**
 * Upper bound on the bounded-model-checking chain length used by the
 * ROP chain builder. The builder tries K=1..N until Z3 returns sat.
 *
 * @env Z3_BMC_MAX_GADGETS
 * @default 12
 */
export const Z3_BMC_MAX_GADGETS = int('Z3_BMC_MAX_GADGETS', 12);

/* ================================================================== */
/*  Packer sandbox                                                     */
/* ================================================================== */

export const PACKER_SANDBOX_TIMEOUT_MS = int('PACKER_SANDBOX_TIMEOUT_MS', 3_000);
