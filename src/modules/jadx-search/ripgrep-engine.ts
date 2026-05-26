/**
 * Ripgrep-backed search engine.
 *
 * Spawns `rg --json --no-heading -n` against the decompile directory and
 * parses the NDJSON event stream into {@link JadxMatch}es. The engine
 * is invoked only when {@link detectRipgrep} reports availability.
 *
 * No `rg` flag exposes a richer search surface than ripgrep's own;
 * mapping back into structured JSON keeps the output identical across
 * engines so callers can treat them interchangeably.
 *
 * @see openspec/changes/add-jadx-search-code/design.md §3.3
 */

import { spawn } from 'node:child_process';
import { sep, resolve as resolvePath } from 'node:path';

import { ToolError } from '@errors/ToolError';

import { JADX_SEARCH_RG_MAX_BUFFER_BYTES, JADX_SEARCH_TIMEOUT_MS } from './constants';
import type { EngineRunOutcome, JadxMatch, NormalizedSearchOptions } from './types';

interface RgBeginEvent {
  type: 'begin';
  data: { path: { text: string } };
}

interface RgEndEvent {
  type: 'end';
  data: { path: { text: string } };
}

interface RgSubmatch {
  match: { text: string };
  start: number;
  end: number;
}

interface RgMatchEvent {
  type: 'match';
  data: {
    path: { text: string };
    lines: { text: string };
    line_number: number;
    submatches: RgSubmatch[];
  };
}

interface RgContextEvent {
  type: 'context';
  data: {
    path: { text: string };
    lines: { text: string };
    line_number: number;
  };
}

type RgEvent = RgBeginEvent | RgEndEvent | RgMatchEvent | RgContextEvent | { type: string };

interface PendingMatch {
  match: JadxMatch;
  /** Number of `after` context lines still expected. */
  afterRemaining: number;
}

interface PerFileState {
  /** Ring buffer of recently observed lines, used to backfill `before` context. */
  recentLines: Array<{ line: number; text: string }>;
  /** Matches that still want trailing context. */
  pendingAfter: PendingMatch[];
  /** Cumulative match count for this file. */
  matchCount: number;
}

function normalizePath(absPath: string, baseDir: string): string {
  // Try to relativise to baseDir using simple prefix stripping (ripgrep
  // emits absolute paths on most platforms when fed absolute roots, and
  // relative paths when fed relative roots; handle both).
  const normalisedBase = baseDir.split(sep).join('/');
  const normalisedPath = absPath.split(sep).join('/');
  const withSlash = normalisedBase.endsWith('/') ? normalisedBase : `${normalisedBase}/`;
  if (normalisedPath.startsWith(withSlash)) {
    return normalisedPath.slice(withSlash.length);
  }
  // If ripgrep emitted a path that isn't under baseDir, fall back to the
  // forward-slashed full path (still deterministic).
  return normalisedPath;
}

function stripTrailingNewline(text: string): string {
  if (text.endsWith('\r\n')) return text.slice(0, -2);
  if (text.endsWith('\n') || text.endsWith('\r')) return text.slice(0, -1);
  return text;
}

function decodeLineText(text: string): string {
  return stripTrailingNewline(text);
}

/**
 * Build the argument list passed to `rg`. Held in its own function so
 * tests can assert the exact flag set without spawning ripgrep.
 */
export function buildRipgrepArgs(opts: NormalizedSearchOptions): string[] {
  const args: string[] = ['--json', '--no-heading', '-n', '--no-config'];
  if (opts.literal) args.push('-F');
  if (opts.caseInsensitive) args.push('-i');
  if (opts.contextLines > 0) {
    args.push('-C', String(opts.contextLines));
  }
  args.push('--max-count', String(opts.maxMatchesPerFile));
  for (const glob of opts.globs) {
    args.push('--glob', glob);
  }
  args.push('--', opts.query, opts.decompileDir);
  return args;
}

/**
 * Engine wrapper. Implemented as a class so tests can override `spawn`
 * via a subclass while keeping the default surface dependency-free.
 */
export class RipgrepEngine {
  constructor(
    private readonly spawnFn: typeof spawn = spawn,
    private readonly rgExecutable: string = 'rg',
  ) {}

  async run(opts: NormalizedSearchOptions): Promise<EngineRunOutcome> {
    const absDir = resolvePath(opts.decompileDir);
    const args = buildRipgrepArgs({ ...opts, decompileDir: absDir });
    const child = this.spawnFn(this.rgExecutable, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdoutSize = 0;
    let stderrBuffer = '';
    let buf = '';
    const matches: JadxMatch[] = [];
    const filesMatched = new Set<string>();
    let truncated = false;
    const perFile = new Map<string, PerFileState>();

    const finalise = (relPath: string): void => {
      perFile.delete(relPath);
    };

    const acceptEvent = (event: RgEvent): boolean => {
      // Returns false when global cap reached → stop processing further events.
      if (event.type === 'begin') {
        const path = (event as RgBeginEvent).data.path.text;
        const rel = normalizePath(path, absDir);
        if (!perFile.has(rel)) {
          perFile.set(rel, {
            recentLines: [],
            pendingAfter: [],
            matchCount: 0,
          });
        }
        return true;
      }

      if (event.type === 'end') {
        const path = (event as RgEndEvent).data.path.text;
        const rel = normalizePath(path, absDir);
        finalise(rel);
        return true;
      }

      if (event.type === 'context') {
        const ctx = event as RgContextEvent;
        const rel = normalizePath(ctx.data.path.text, absDir);
        const state = perFile.get(rel);
        if (!state) return true;
        const lineText = decodeLineText(ctx.data.lines.text);
        const entry = { line: ctx.data.line_number, text: lineText };
        // Feed any pending after-context slots first.
        const stillPending: PendingMatch[] = [];
        for (const pending of state.pendingAfter) {
          if (pending.afterRemaining > 0 && pending.match.context) {
            pending.match.context.after.push(entry);
            pending.afterRemaining -= 1;
          }
          if (pending.afterRemaining > 0) {
            stillPending.push(pending);
          }
        }
        state.pendingAfter = stillPending;
        // Also track the line in the ring buffer for future matches'
        // `before` slots — ripgrep emits context BEFORE its match for
        // leading context, so we record everything.
        state.recentLines.push(entry);
        if (state.recentLines.length > Math.max(opts.contextLines, 8)) {
          state.recentLines.shift();
        }
        return true;
      }

      if (event.type === 'match') {
        const me = event as RgMatchEvent;
        const rel = normalizePath(me.data.path.text, absDir);
        const state = perFile.get(rel) ?? {
          recentLines: [],
          pendingAfter: [],
          matchCount: 0,
        };
        if (!perFile.has(rel)) perFile.set(rel, state);

        if (state.matchCount >= opts.maxMatchesPerFile) {
          truncated = true;
          return true;
        }
        // Check the global cap BEFORE pushing so we never overshoot it.
        if (matches.length >= opts.maxResults) {
          truncated = true;
          return false;
        }
        const sub = me.data.submatches[0];
        if (!sub) return true;
        const lineText = decodeLineText(me.data.lines.text);
        const matchStart = sub.start + 1;
        const matchEnd = sub.end + 1;
        const match: JadxMatch = {
          file: rel,
          line: me.data.line_number,
          column: matchStart,
          text: lineText,
          matchStart,
          matchEnd,
        };
        if (opts.contextLines > 0) {
          const before = state.recentLines
            .filter((entry) => entry.line < me.data.line_number)
            .slice(-opts.contextLines);
          match.context = { before, after: [] };
          state.pendingAfter.push({ match, afterRemaining: opts.contextLines });
        }
        matches.push(match);
        filesMatched.add(rel);
        state.matchCount += 1;
        if (matches.length >= opts.maxResults) {
          truncated = true;
          return false;
        }
        return true;
      }

      return true;
    };

    return new Promise<EngineRunOutcome>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(
          new ToolError('TIMEOUT', `ripgrep timed out after ${JADX_SEARCH_TIMEOUT_MS} ms`, {
            details: { timeoutMs: JADX_SEARCH_TIMEOUT_MS },
          }),
        );
      }, JADX_SEARCH_TIMEOUT_MS);

      let stopped = false;
      const stop = (): void => {
        if (stopped) return;
        stopped = true;
        clearTimeout(timer);
      };

      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');

      child.stdout?.on('data', (chunk: string) => {
        if (stopped) return;
        stdoutSize += chunk.length;
        if (stdoutSize > JADX_SEARCH_RG_MAX_BUFFER_BYTES) {
          child.kill('SIGKILL');
          stop();
          reject(
            new ToolError(
              'RUNTIME',
              `ripgrep stdout exceeded JADX_SEARCH_RG_MAX_BUFFER_BYTES (${JADX_SEARCH_RG_MAX_BUFFER_BYTES} bytes)`,
            ),
          );
          return;
        }
        buf += chunk;
        let newline = buf.indexOf('\n');
        while (newline !== -1) {
          const raw = buf.slice(0, newline).trimEnd();
          buf = buf.slice(newline + 1);
          if (raw.length > 0) {
            let event: RgEvent | undefined;
            try {
              event = JSON.parse(raw) as RgEvent;
            } catch {
              // Skip malformed lines silently — ripgrep occasionally emits
              // diagnostic output on stderr but never on stdout in --json
              // mode, so a parse failure means the buffer was truncated.
            }
            if (event) {
              const keepGoing = acceptEvent(event);
              if (!keepGoing) {
                buf = '';
                // Stop event processing immediately so trailing data
                // buffered before SIGTERM arrives is discarded.
                stop();
                child.kill('SIGTERM');
                break;
              }
            }
          }
          newline = buf.indexOf('\n');
        }
      });

      child.stderr?.on('data', (chunk: string) => {
        stderrBuffer += chunk;
      });

      child.on('error', (err) => {
        stop();
        reject(
          new ToolError('RUNTIME', `ripgrep spawn failed: ${err.message}`, {
            cause: err as Error,
          }),
        );
      });

      child.on('close', (code, signal) => {
        stop();
        // ripgrep exit codes:
        //   0 = matches found
        //   1 = no matches (still success)
        //   2 = error
        // Ignore exit 2 when we manually killed it after hitting maxResults.
        if (code === 2 && signal !== 'SIGTERM' && signal !== 'SIGKILL') {
          reject(
            new ToolError('RUNTIME', `ripgrep exited with code 2: ${stderrBuffer.trim()}`, {
              details: { exitCode: code, signal: signal ?? null, stderr: stderrBuffer.trim() },
            }),
          );
          return;
        }
        // Flush trailing partial line (if any) — should be empty when
        // ripgrep terminated cleanly. We keep the count around purely
        // for the budget check above.
        void stdoutSize;
        resolve({
          matches,
          filesMatched: filesMatched.size,
          truncated,
        });
      });
    });
  }
}

// (No external helpers re-exported — buildRipgrepArgs is exported at the
// top of the file for tests that want to assert on the flag list.)
