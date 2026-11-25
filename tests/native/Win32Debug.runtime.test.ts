/**
 * Runtime integration test for Win32Debug thread enumeration and debug
 * registers. Gated to Windows + JSHOOK_NATIVE_RUNTIME=1 so the default suite
 * stays portable; run elevated (SeDebugPrivilege) to exercise the real FFI.
 *
 * The target is a fresh Node child process: suspending a thread in the Vitest
 * worker itself would suspend the code that has to resume it.
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CONTEXT_FLAGS,
  EnumerateProcessThreads,
  GetThreadContext,
  SetThreadContext,
  SuspendThread,
  ResumeThread,
  openThreadForDebug,
} from '@native/Win32Debug';
import { CloseHandle } from '@native/Win32API';

const WIN32_RUNTIME = process.platform === 'win32' && process.env.JSHOOK_NATIVE_RUNTIME === '1';

async function waitForThreads(pid: number): Promise<number[]> {
  for (let i = 0; i < 30; i++) {
    const threads = EnumerateProcessThreads(pid);
    if (threads.length > 0) return threads;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return [];
}

describe.skipIf(!WIN32_RUNTIME)('Win32Debug — real thread/context FFI', () => {
  let child: ReturnType<typeof spawn> | undefined;

  afterEach(async () => {
    if (child && child.exitCode === null) {
      child.kill();
      await Promise.race([
        once(child, 'exit'),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
    }
    child = undefined;
  });

  it('enumerates a child process and round-trips an unchanged context', async () => {
    child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    expect(child.pid).toBeTypeOf('number');

    const threads = await waitForThreads(child.pid!);
    expect(threads.length).toBeGreaterThan(0);

    const handle = openThreadForDebug(threads[0]!);
    try {
      SuspendThread(handle);
      try {
        const ctx = GetThreadContext(handle, CONTEXT_FLAGS.CONTROL);
        expect(ctx.length).toBeGreaterThan(0);
        // Exercise the real SetThreadContext FFI without changing registers.
        SetThreadContext(handle, ctx);
      } finally {
        ResumeThread(handle);
      }
    } finally {
      CloseHandle(handle);
    }
  });
});
