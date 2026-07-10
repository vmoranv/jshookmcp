/**
 * Linux /proc/{pid}/task/{tid} per-thread status parser.
 *
 * `process_enum_threads` on Linux only returns thread IDs. The per-thread
 * `status` + `comm` files add the State (running/sleeping/zombie/...), the
 * kernel thread name, and context-switch counts — enough to answer "which
 * thread is actually executing" and "what is each thread blocked on" without
 * a native GetThreadContext binding. Win32 register-context (RIP/RSP/...) is
 * out of scope here (needs a koffi binding) and left as a documented gap.
 */
import { readFile } from 'node:fs/promises';

export interface ProcThreadStatus {
  /** Kernel sched state code, e.g. R/S/D/Z/T. */
  state?: string;
  /** Human-readable state name. */
  stateName?: string;
  /** Thread name from /proc/{pid}/task/{tid}/comm. */
  name?: string;
  voluntarySwitches?: number;
  nonvoluntarySwitches?: number;
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
 * Parse the textual content of `/proc/{pid}/task/{tid}/status` (optionally
 * enriched with the thread name from `comm`). Pure function — safe to unit
 * test without a real /proc filesystem.
 */
export function parseProcThreadStatus(statusContent: string, comm?: string): ProcThreadStatus {
  const result: ProcThreadStatus = {};
  if (comm && comm.length > 0) {
    result.name = comm;
  }
  for (const line of statusContent.split('\n')) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1] as string;
    const val = (m[2] ?? '').trim();
    if (key === 'State') {
      const sm = val.match(/^([A-Za-z])\s*(.*)$/);
      if (sm) {
        const code = sm[1] as string;
        result.state = code;
        result.stateName = STATE_NAMES[code] ?? sm[2];
      }
    } else if (key === 'voluntary_ctxt_switches') {
      const n = Number(val);
      if (Number.isFinite(n)) result.voluntarySwitches = n;
    } else if (key === 'nonvoluntary_ctxt_switches') {
      const n = Number(val);
      if (Number.isFinite(n)) result.nonvoluntarySwitches = n;
    }
  }
  return result;
}

/**
 * Read and parse per-thread status from /proc. Fail-soft: returns `{}` when
 * /proc is unavailable (non-Linux, process gone, or permission denied) so the
 * caller's thread enumeration never breaks.
 */
export async function readThreadStatusSafe(pid: number, tid: number): Promise<ProcThreadStatus> {
  try {
    const base = `/proc/${pid}/task/${tid}`;
    const status = await readFile(`${base}/status`, 'utf-8');
    let comm: string | undefined;
    try {
      comm = (await readFile(`${base}/comm`, 'utf-8')).trim();
    } catch {
      // comm is optional — some kernels/threads lack it
    }
    return parseProcThreadStatus(status, comm);
  } catch {
    return {};
  }
}
