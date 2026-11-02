/**
 * TurboFan Trace Collector
 *
 * Discovers and collects V8 --trace-turbo JSON output files.
 * Two collection modes:
 *
 *   1. **Isolated process**: Spawns a dedicated Node.js child with
 *      --trace-turbo --trace-turbo-path=<tmpdir>, runs a target script,
 *      then reads the JSON files from that directory. No browser needed.
 *
 *   2. **Browser relay**: If a browser was launched with --trace-turbo
 *      flags (through UnifiedBrowserManager), reads the output directory
 *      for already-generated files.
 *
 * The isolated mode extends NativeBytecodePrinter.ts pattern (spawn child
 * with V8 flags, feed source via stdin, capture output). But instead of
 * --print-bytecode it uses --trace-turbo which writes turbo-*.json files.
 *
 * @module TurboFanTraceCollector
 */

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '@utils/logger';
import { getArtifactDir } from '@utils/artifacts';
import {
  normalizeFunctionName,
  parseStatusLine,
  shouldWrapAsObjectMember,
} from './isolated-v8-utils';
import {
  parseTurboFanJSONFiles,
  type TurboFanIRGraph,
  type ParsedTurboFanResult,
} from './TurboFanGraphParser';

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;
const TARGET_NAME = '__jshookTurbofanTarget__';
const STATUS_PREFIX = '__JSHOOK_TURBOFAN_STATUS__:';
/** Warm-up call count before the target is expected to reach TurboFan tier. */
const TURBOFAN_WARMUP_CALLS = 10;
/** stderr excerpt length used in process-error reasons. */
const STDERR_EXCERPT_CHARS = 200;

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TurboFanSourceContext {
  /** Function name for --trace-turbo-filter */
  functionName: string;
  /** Source code of the target function / fragment */
  sourceSlice: string;
}

export interface TurboFanTraceResult {
  available: boolean;
  graphs: TurboFanIRGraph[];
  graphCount: number;
  reason: string;
  /** The temporary directory used (for cleanup) */
  traceDir: string | null;
  /** Duration of the isolated process in ms, if applicable */
  durationMs: number | null;
}

// ── Bootstrap Script Builder ──────────────────────────────────────────────────

function buildBootstrapScript(context: TurboFanSourceContext): string {
  const source = context.sourceSlice.trim();
  const requestedName = context.functionName.trim();
  const bindingCode = shouldWrapAsObjectMember(source)
    ? `
try {
  const __jshookHolder = { ${source} };
  const __jshookCandidate = __jshookHolder[${JSON.stringify(requestedName)}];
  if (typeof __jshookCandidate === 'function') {
    ${TARGET_NAME} = __jshookCandidate;
  }
} catch {}
`
    : `
try {
  ${TARGET_NAME} = (${source});
} catch {}
`;

  return `
let ${TARGET_NAME};
${bindingCode}

if (typeof ${TARGET_NAME} !== 'function') {
  console.log(${JSON.stringify(`${STATUS_PREFIX}resolve-failed`)});
} else {
  try {
    // Warm up: call once to compile with Ignition, then force TurboFan
    const __jshookArity =
      typeof ${TARGET_NAME}.length === 'number' && ${TARGET_NAME}.length > 0
        ? ${TARGET_NAME}.length
        : 1;
    const __jshookArgs = Array.from({ length: __jshookArity }, () => undefined);
    // Multiple calls to trigger TurboFan optimization
    for (let __jshookI = 0; __jshookI < ${TURBOFAN_WARMUP_CALLS}; __jshookI += 1) {
      Reflect.apply(${TARGET_NAME}, globalThis, __jshookArgs);
    }
  } catch (error) {
    console.log(${JSON.stringify(`${STATUS_PREFIX}invoke-error:`)} + String(error));
  }
  console.log(${JSON.stringify(`${STATUS_PREFIX}done`)});
}
`;
}

// ── Isolated Process Runner ───────────────────────────────────────────────────

function createTraceDir(): string {
  // Route V8 --trace-turbo output through the project's unified artifact
  // tree (`artifacts/tmp/...`) rather than the OS temp dir. This keeps all
  // tool-produced files inside the project root where the artifact
  // retention sweep can find and clean them, and (critically) lets us set
  // the child's CWD to the trace dir so V8's turbo-<pid>-<srcId>.cfg files
  // land there too instead of leaking into whatever CWD launched the MCP
  // server (often the repo root in dev).
  const base = getArtifactDir('tmp');
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, 'jshook-turbofan-'));
}

async function runTraceTurboProcess(
  bootstrapScript: string,
  filterName: string,
  traceDir: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; error: string | null }> {
  return await new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        `--trace-turbo`,
        `--trace-turbo-path=${traceDir}`,
        `--trace-turbo-filter=${filterName}`,
        '--allow-natives-syntax',
        '-',
      ],
      // CWD must be the trace dir: --trace-turbo-path only redirects the
      // turbo-*.json IR dumps, but V8 also writes turbo-<pid>-<srcId>.cfg
      // (C1 visualizer format) to the child's CWD. Redirecting CWD here
      // keeps the .cfg files inside the temp trace dir so cleanupTraceDir()
      // removes them — otherwise they leak into the repo root.
      { stdio: ['pipe', 'pipe', 'pipe'], cwd: traceDir },
    );

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (error: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, error });
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(`Timed out after ${timeoutMs}ms while waiting for --trace-turbo output`);
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      finish(error instanceof Error ? error.message : String(error));
    });
    child.on('close', (code) => {
      finish(code === 0 ? null : `Trace process exited with code ${code}`);
    });
    child.stdin.end(bootstrapScript);
  });
}

function readTraceDir(traceDir: string): Array<{ filename: string; content: string }> {
  const files: Array<{ filename: string; content: string }> = [];
  try {
    const entries = readdirSync(traceDir);
    for (const entry of entries) {
      // turbo-*.json = IR graphs we want to parse.
      // turbo-*.cfg = C1 visualizer format (also written by --trace-turbo);
      // ignored here — they're cleaned up by cleanupTraceDir() alongside the JSON.
      if (entry.startsWith('turbo-') && entry.endsWith('.json')) {
        const fullPath = join(traceDir, entry);
        try {
          const content = readFileSync(fullPath, 'utf8');
          files.push({ filename: entry, content });
        } catch (e) {
          logger.debug(`Failed to read ${fullPath}: ${e}`);
        }
      }
    }
  } catch (e) {
    logger.debug(`Failed to read trace dir ${traceDir}: ${e}`);
  }
  return files;
}

function cleanupTraceDir(traceDir: string): void {
  try {
    rmSync(traceDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Collect TurboFan IR graphs by spawning an isolated V8 process with --trace-turbo.
 *
 * This is the "offline" mode: no browser or CDP needed. The function spawns
 * a child Node.js process with V8 flags that dump TurboFan IR as JSON files,
 * then parses those files into structured TurboFanIRGraph objects.
 *
 * @param context - Function name + source slice to trace
 * @param timeoutMs - Maximum time to wait for the child process (default: 30s)
 * @param keepTraceDir - If true, don't delete the temp trace directory after parsing
 */
export async function collectTurboFanIRIsolated(
  context: TurboFanSourceContext,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  keepTraceDir: boolean = false,
): Promise<TurboFanTraceResult> {
  const requestedName = normalizeFunctionName(context.functionName, TARGET_NAME);
  const candidateNames = Array.from(new Set([requestedName, TARGET_NAME]));
  const traceDir = createTraceDir();
  const startTime = Date.now();

  try {
    for (const filterName of candidateNames) {
      // Fresh trace dir per candidate — a partially-failed earlier candidate
      // may have left turbo-*.json files that would mix into the next parse.
      cleanupTraceDir(traceDir);
      mkdirSync(traceDir, { recursive: true });
      const bootstrapScript = buildBootstrapScript(context);

      const { stdout, stderr, error } = await runTraceTurboProcess(
        bootstrapScript,
        filterName,
        traceDir,
        timeoutMs,
      );

      // Check if the function compiled
      const status = parseStatusLine(stdout, STATUS_PREFIX);

      if (error && !status) {
        // Process failed before function even ran — try next candidate
        if (filterName !== candidateNames.at(-1)) {
          continue;
        }
        // Last candidate failed
        return {
          available: false,
          graphs: [],
          graphCount: 0,
          reason:
            stderr.trim().length > 0
              ? `Process error: ${stderr.trim().slice(0, STDERR_EXCERPT_CHARS)}`
              : (error ?? 'Unknown process error'),
          traceDir: null,
          durationMs: Date.now() - startTime,
        };
      }

      if (status === 'resolve-failed') {
        if (filterName !== candidateNames.at(-1)) {
          continue;
        }
        return {
          available: false,
          graphs: [],
          graphCount: 0,
          reason: 'Unable to reconstruct an executable function from the captured source slice',
          traceDir: null,
          durationMs: Date.now() - startTime,
        };
      }

      // Read any generated JSON files
      const jsonFiles = readTraceDir(traceDir);

      if (jsonFiles.length === 0) {
        // Function ran but no TurboFan JSON was generated — likely never optimized
        // (not hot enough or too small for TurboFan)
        if (filterName !== candidateNames.at(-1)) {
          continue;
        }
        return {
          available: false,
          graphs: [],
          graphCount: 0,
          reason:
            'Function executed but did not trigger TurboFan compilation. ' +
            'The function may be too small, not hot enough, or contain constructs that prevent optimization. ' +
            'Try wrapping it in a loop with more iterations.',
          traceDir: null,
          durationMs: Date.now() - startTime,
        };
      }

      // Parse JSON files
      const parsed: ParsedTurboFanResult = parseTurboFanJSONFiles(jsonFiles);

      // Success: hand the trace dir to the caller if they want to keep it,
      // otherwise drop the (possibly large) raw IR + cfg files now.
      if (!keepTraceDir) cleanupTraceDir(traceDir);

      return {
        available: parsed.available,
        graphs: parsed.graphs,
        graphCount: parsed.graphCount,
        reason: parsed.reason,
        traceDir: keepTraceDir ? traceDir : null,
        durationMs: Date.now() - startTime,
      };
    }

    // Should not reach here, but safety fallback
    return {
      available: false,
      graphs: [],
      graphCount: 0,
      reason: 'No matching function found for --trace-turbo-filter',
      traceDir: null,
      durationMs: Date.now() - startTime,
    };
  } finally {
    // Guarantee cleanup on every exit path (success-with-keep, failure,
    // and unexpected throw) so V8's turbo-*.json + turbo-*.cfg artifacts
    // never leak into the project tree when the caller didn't request
    // keepTraceDir. Previously a thrown error skipped cleanupTraceDir().
    if (!keepTraceDir) {
      cleanupTraceDir(traceDir);
    }
  }
}

/**
 * Collect TurboFan IR graphs from a pre-existing trace directory.
 *
 * This is the "browser relay" mode: if a browser was launched with
 * --js-flags="--trace-turbo --trace-turbo-path=<dir>", read already-generated
 * JSON files from that directory.
 *
 * @param traceDir - Path to the directory containing turbo-*.json files
 */
export function collectTurboFanIRFromDir(traceDir: string): TurboFanTraceResult {
  const jsonFiles = readTraceDir(traceDir);
  const parsed: ParsedTurboFanResult = parseTurboFanJSONFiles(jsonFiles);

  return {
    available: parsed.available,
    graphs: parsed.graphs,
    graphCount: parsed.graphCount,
    reason: parsed.reason,
    traceDir,
    durationMs: null,
  };
}

// Re-export parser types for convenience
export type {
  TurboFanNode,
  TurboFanEdge,
  TurboFanEdgeType,
  TurboFanGraphPhase,
  TurboFanIRGraph,
  ParsedTurboFanResult,
} from './TurboFanGraphParser';
