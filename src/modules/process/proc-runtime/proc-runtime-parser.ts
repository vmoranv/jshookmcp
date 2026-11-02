/**
 * Linux /proc/{pid} runtime-info parsers (environ, cmdline, status).
 *
 * Sibling of threads/thread-status-parser.ts. These three files are the
 * standard Linux sources for "what does this process look like at runtime":
 *   - /proc/{pid}/environ  : NUL-separated KEY=VALUE environment variables
 *   - /proc/{pid}/cmdline  : NUL-separated argv (command-line arguments)
 *   - /proc/{pid}/status   : key: value human-readable process metadata
 *
 * All parsers are pure functions of file content — safe to unit test without a
 * real /proc filesystem. I/O wrappers over these parsers must be fail-soft
 * (return partial results when a file is unreadable) so a missing status file
 * does not discard environ/cmdline.
 *
 * Honesty: no built-in secret/sensitive-key database. Every environment
 * variable is returned verbatim; the caller decides what to redact. This is
 * deliberate — a reverse-engineering tool must not silently hide values its
 * author guessed were sensitive.
 */

import { readFile } from 'node:fs/promises';

/** Selected fields from /proc/{pid}/status, normalized. Unknown fields are omitted. */
export interface ProcStatusSummary {
  name?: string;
  pid?: number;
  ppid?: number;
  /** State code + name, e.g. "R (Running)". */
  state?: string;
  uid?: string;
  gid?: string;
  /** Virtual memory size, raw textual value incl. unit, e.g. "123456 kB". */
  vmSize?: string;
  vmRSS?: string;
  vmPeak?: string;
  threads?: number;
  /** Effective capability set (hex), Win32/macOS have no equivalent. */
  capEff?: string;
}

export interface ProcessRuntimeInfo {
  cmdline: string[];
  environ: Record<string, string>;
  status: ProcStatusSummary;
}

/**
 * Parse /proc/{pid}/environ content (NUL-separated KEY=VALUE). Pure.
 * Entries without '=' are skipped. Duplicate keys keep the last value (matches
 * real process getenv semantics where later definitions win).
 */
export function parseProcEnviron(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of content.split('\0')) {
    if (entry.length === 0) continue;
    const eq = entry.indexOf('=');
    if (eq <= 0) continue; // skip malformed / keys with no '='
    const key = entry.slice(0, eq);
    const value = entry.slice(eq + 1);
    out[key] = value;
  }
  return out;
}

/**
 * Parse /proc/{pid}/cmdline content (NUL-separated argv). Pure.
 * A trailing empty element (from the terminal NUL) is dropped.
 */
export function parseProcCmdline(content: string): string[] {
  const parts = content.split('\0');
  // Drop a single trailing empty string produced by the final NUL.
  if (parts.length > 0 && parts[parts.length - 1] === '') {
    parts.pop();
  }
  return parts;
}

const STATE_NAMES: Record<string, string> = {
  R: 'Running',
  S: 'Sleeping',
  D: 'Disk sleep',
  Z: 'Zombie',
  T: 'Stopped',
  t: 'Tracing stop',
  I: 'Idle',
  P: 'Parked',
};

/**
 * Parse /proc/{pid}/status content into a summary subset. Pure.
 * Only well-known fields are extracted; unknown keys are ignored.
 */
export function parseProcStatusSummary(content: string): ProcStatusSummary {
  const out: ProcStatusSummary = {};
  for (const line of content.split('\n')) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1] as string;
    const val = (m[2] ?? '').trim();
    switch (key) {
      case 'Name':
        out.name = val;
        break;
      case 'Pid': {
        const n = Number(val);
        if (Number.isFinite(n)) out.pid = n;
        break;
      }
      case 'PPid': {
        const n = Number(val);
        if (Number.isFinite(n)) out.ppid = n;
        break;
      }
      case 'State': {
        const sm = val.match(/^([A-Za-z])\s*(.*)$/);
        if (sm) {
          const code = sm[1] as string;
          // sm[2] may already include parentheses ("Q (queued-on-mars)"); strip
          // one layer so unknown states don't render as "Q ((queued-on-mars))".
          const tail = (sm[2] ?? '').replace(/^\((.*)\)$/, '$1').trim();
          const name = STATE_NAMES[code] ?? tail;
          out.state = name.length > 0 ? `${code} (${name})` : code;
        }
        break;
      }
      case 'Uid':
        out.uid = val;
        break;
      case 'Gid':
        out.gid = val;
        break;
      case 'VmSize':
        out.vmSize = val;
        break;
      case 'VmRSS':
        out.vmRSS = val;
        break;
      case 'VmPeak':
        out.vmPeak = val;
        break;
      case 'Threads': {
        const n = Number(val);
        if (Number.isFinite(n)) out.threads = n;
        break;
      }
      case 'CapEff':
        out.capEff = val;
        break;
      default:
        break;
    }
  }
  return out;
}

/**
 * Read /proc/{pid} runtime info. Fail-soft per file: an unreadable file
 * (permission, process gone) leaves that field empty instead of aborting.
 */
export async function readProcessRuntimeSafe(
  pid: number,
): Promise<{ available: true; info: ProcessRuntimeInfo } | { available: false; error: string }> {
  const base = `/proc/${pid}`;
  let gotAny = false;
  let lastError = '';
  const cmdline: string[] = [];
  const environ: Record<string, string> = {};
  const status: ProcStatusSummary = {};
  try {
    const c = await readFile(`${base}/cmdline`, 'utf-8');
    for (const a of parseProcCmdline(c)) cmdline.push(a);
    gotAny = true;
  } catch (err) {
    lastError = String(err);
  }
  try {
    const e = await readFile(`${base}/environ`, 'utf-8');
    Object.assign(environ, parseProcEnviron(e));
    gotAny = true;
  } catch (err) {
    lastError = String(err);
  }
  try {
    const s = await readFile(`${base}/status`, 'utf-8');
    Object.assign(status, parseProcStatusSummary(s));
    gotAny = true;
  } catch (err) {
    lastError = String(err);
  }
  if (!gotAny) {
    return { available: false, error: lastError };
  }
  return { available: true, info: { cmdline, environ, status } };
}
