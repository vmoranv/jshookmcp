import { describe, expect, it } from 'vitest';
import { parseProcThreadStatus } from '@modules/process/threads/thread-status-parser';

const SAMPLE_STATUS = `Name:\tapp
Umask:\t0022
State:\tS (sleeping)
Tgid:\t1234
Ngid:\t0
Pid:\t1234
PPid:\t1
voluntary_ctxt_switches:\t42
nonvoluntary_ctxt_switches:\t7`;

describe('parseProcThreadStatus', () => {
  it('extracts state, context switches, and comm name', () => {
    const result = parseProcThreadStatus(SAMPLE_STATUS, 'worker-thread');
    expect(result).toEqual({
      name: 'worker-thread',
      state: 'S',
      stateName: 'Sleeping',
      voluntarySwitches: 42,
      nonvoluntarySwitches: 7,
    });
  });

  it('maps each state code to a readable name', () => {
    expect(parseProcThreadStatus('State:\tR (running)').stateName).toBe('Running');
    expect(parseProcThreadStatus('State:\tZ (zombie)').stateName).toBe('Zombie');
    expect(parseProcThreadStatus('State:\tD (disk sleep)').stateName).toBe('Disk sleep');
  });

  it('falls back to the kernel-provided description for unknown state codes', () => {
    expect(parseProcThreadStatus('State:\tX (dead)').stateName).toBe('(dead)');
  });

  it('omits name when comm is not supplied', () => {
    const result = parseProcThreadStatus('State:\tT (stopped)');
    expect(result.name).toBeUndefined();
    expect(result.state).toBe('T');
  });

  it('tolerates malformed / empty input', () => {
    expect(parseProcThreadStatus('')).toEqual({});
    expect(parseProcThreadStatus('not a status line\nno colon here')).toEqual({});
  });
});
