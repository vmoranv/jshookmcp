/**
 * Process Suspend/Resume Handlers
 *
 * Cross-platform process suspension for forensic snapshotting.
 *   - Win32:  NtSuspendProcess / NtResumeProcess
 *   - Linux:  SIGSTOP / SIGCONT
 *   - macOS:  task_suspend / task_resume (Mach API)
 *
 * Wraps the shared suspendProcess/resumeProcess primitives exposed by
 * @modules/process/memory/scanner (also used internally by scanMemory
 * when suspendTarget=true).
 */

import { argNumber } from '@server/domains/shared/parse-args';
import type { Platform } from '@modules/process/memory/types';
import type { ProcessManagementHandlers } from './process-management';

export class ProcessSuspendHandlers {
  private processMgmt?: ProcessManagementHandlers;

  constructor(processMgmt?: ProcessManagementHandlers) {
    this.processMgmt = processMgmt;
  }

  async handleProcessSuspend(args: Record<string, unknown>): Promise<unknown> {
    const pid = argNumber(args, 'pid');
    if (!pid || pid <= 0) {
      return { success: false, error: 'pid must be a positive integer' };
    }

    const platform = (this.processMgmt?.platformValue ?? process.platform) as Platform;

    try {
      const { suspendProcess } = await import('@modules/process/memory/scanner');
      const suspended = await suspendProcess(platform, pid);
      return {
        success: true,
        pid,
        suspended,
        platform,
        message: suspended
          ? `Suspended process ${pid}`
          : `Failed to suspend process ${pid} (already exited? permissions?)`,
      };
    } catch (err) {
      return { success: false, pid, error: String(err) };
    }
  }

  async handleProcessResume(args: Record<string, unknown>): Promise<unknown> {
    const pid = argNumber(args, 'pid');
    if (!pid || pid <= 0) {
      return { success: false, error: 'pid must be a positive integer' };
    }

    const platform = (this.processMgmt?.platformValue ?? process.platform) as Platform;

    try {
      const { resumeProcess } = await import('@modules/process/memory/scanner');
      await resumeProcess(platform, pid);
      return {
        success: true,
        pid,
        resumed: true,
        platform,
      };
    } catch (err) {
      return { success: false, pid, error: String(err) };
    }
  }
}
