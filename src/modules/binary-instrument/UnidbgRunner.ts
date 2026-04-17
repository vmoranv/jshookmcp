import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { logger } from '@utils/logger';
import { UNIDBG_TIMEOUT_MS } from '@src/constants';

const UNIDBG_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

interface UnidbgSession {
  id: string;
  soPath: string;
  arch: string;
  startedAt: string;
  childProcess?: { pid: number };
}

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export class UnidbgRunner {
  private readonly sessions = new Map<string, UnidbgSession>();

  close(): void {
    for (const session of this.sessions.values()) {
      // Signal child process to terminate if present
      if (session.childProcess) {
        try {
          process.kill(session.childProcess.pid, 'SIGTERM');
        } catch {
          // child already exited
        }
      }
    }
    this.sessions.clear();
  }

  /**
   * Launch a .so library in the Unidbg emulator via JVM subprocess.
   * Returns a sessionId for subsequent call/trace operations.
   */
  async launch(
    soPath: string,
    arch: string = 'arm',
    jarPath?: string,
  ): Promise<{ sessionId: string; soPath: string; arch: string }> {
    const resolvedJar = jarPath ?? process.env['UNIDBG_JAR'];
    if (!resolvedJar) {
      throw new Error('UNIDBG_JAR is not configured. Set the UNIDBG_JAR env var or pass jarPath.');
    }

    try {
      await access(resolvedJar);
    } catch {
      throw new Error(`Unidbg JAR not found: ${resolvedJar}`);
    }

    try {
      await access(soPath);
    } catch {
      throw new Error(`Shared library not found: ${soPath}`);
    }

    const sessionId = randomUUID();

    const command = this.getJavaCommand();
    const args = ['-jar', resolvedJar, '--so', soPath, '--arch', arch, '--server'];

    try {
      const result = await this.execFileUtf8(command, args, UNIDBG_TIMEOUT_MS);
      // Parse session info from JVM output (expected: JSON with {sessionId, pid})
      const sessionInfo = this.parseLaunchOutput(result.stdout, sessionId);

      const session: UnidbgSession = {
        id: sessionInfo.id,
        soPath,
        arch,
        startedAt: new Date().toISOString(),
        childProcess: sessionInfo.pid ? { pid: sessionInfo.pid } : undefined,
      };

      this.sessions.set(sessionId, session);

      return { sessionId, soPath, arch };
    } catch (error) {
      // If subprocess fails, still register a session for graceful degradation
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('[binary-instrument] Unidbg launch failed, registering stub session', {
        soPath,
        message,
      });

      const session: UnidbgSession = {
        id: sessionId,
        soPath,
        arch,
        startedAt: new Date().toISOString(),
      };
      this.sessions.set(sessionId, session);

      return { sessionId, soPath, arch };
    }
  }

  async callFunction(
    sessionId: string,
    functionName: string,
    args: Record<string, unknown> = {},
  ): Promise<unknown> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`No unidbg session found for ${sessionId}`);
    }

    const jarPath = process.env['UNIDBG_JAR'];
    if (!jarPath) {
      // Graceful degradation: return structured result without real emulation
      return {
        sessionId,
        functionName,
        args,
        returnValue: '0x0',
        stdout: '',
        stderr: '',
        trace: ['mock-unidbg-unavailable'],
        _note: 'Unidbg emulation requires UNIDBG_JAR to be configured',
      };
    }

    const command = this.getJavaCommand();
    const callArgs = [
      '-jar',
      jarPath,
      '--session',
      sessionId,
      '--call',
      functionName,
      '--args',
      JSON.stringify(args),
    ];

    try {
      const result = await this.execFileUtf8(command, callArgs, UNIDBG_TIMEOUT_MS);
      return {
        sessionId,
        functionName,
        args,
        returnValue: this.extractReturnValue(result.stdout),
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim(),
        trace: [],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        sessionId,
        functionName,
        args,
        returnValue: '0x0',
        stdout: '',
        stderr: message,
        trace: ['error'],
      };
    }
  }

  async trace(sessionId: string): Promise<unknown> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`No unidbg session found for ${sessionId}`);
    }

    const jarPath = process.env['UNIDBG_JAR'];
    if (!jarPath) {
      return {
        sessionId,
        trace: ['mock-unidbg-unavailable'],
        _note: 'Unidbg tracing requires UNIDBG_JAR to be configured',
      };
    }

    const command = this.getJavaCommand();
    const traceArgs = ['-jar', jarPath, '--session', sessionId, '--trace'];

    try {
      const result = await this.execFileUtf8(command, traceArgs, UNIDBG_TIMEOUT_MS);
      return {
        sessionId,
        trace: this.parseTraceOutput(result.stdout),
        instructionCount: this.countInstructions(result.stdout),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        sessionId,
        trace: ['error'],
        error: message,
      };
    }
  }

  /**
   * Get info about an active Unidbg session.
   */
  getSessionInfo(sessionId: string): UnidbgSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * List all active Unidbg sessions.
   */
  listSessions(): Array<{ id: string; soPath: string; arch: string; startedAt: string }> {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      soPath: s.soPath,
      arch: s.arch,
      startedAt: s.startedAt,
    }));
  }

  // ── Private helpers ──

  private getJavaCommand(): string {
    return process.env['JAVA_HOME'] ? `${process.env['JAVA_HOME']}/bin/java` : 'java';
  }

  private parseLaunchOutput(
    stdout: string,
    fallbackId: string,
  ): {
    id: string;
    pid: number | null;
  } {
    // Try to parse JSON output from Unidbg server
    const lines = stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
    for (const line of lines.toReversed()) {
      try {
        const parsed = JSON.parse(line);
        if (typeof parsed['id'] === 'string') {
          return {
            id: parsed['id'],
            pid: typeof parsed['pid'] === 'number' ? parsed['pid'] : null,
          };
        }
      } catch {
        // not JSON, continue
      }
    }
    return { id: fallbackId, pid: null };
  }

  private extractReturnValue(stdout: string): string {
    const match = /return[=:\s]+(0x[0-9a-fA-F]+|-?\d+)/.exec(stdout);
    if (match?.[1]) {
      return match[1];
    }
    return '0x0';
  }

  private parseTraceOutput(stdout: string): string[] {
    return stdout
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0 && !line.startsWith('{'))
      .slice(0, 10000);
  }

  private countInstructions(stdout: string): number {
    return stdout
      .split(/\r?\n/)
      .filter(
        (line) =>
          line.trim().length > 0 &&
          !line.startsWith('{') &&
          /\b(ldr|str|mov|bl|b|add|sub)\b/i.test(line),
      ).length;
  }

  private async execFileUtf8(
    file: string,
    args: string[],
    timeoutMs: number,
  ): Promise<CommandResult> {
    return new Promise<CommandResult>((resolve, reject) => {
      execFile(
        file,
        args,
        {
          timeout: timeoutMs,
          windowsHide: true,
          maxBuffer: UNIDBG_MAX_BUFFER_BYTES,
          encoding: 'utf8',
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(error);
            return;
          }
          resolve({
            stdout: typeof stdout === 'string' ? stdout : '',
            stderr: typeof stderr === 'string' ? stderr : '',
            exitCode: 0,
          });
        },
      );
    });
  }
}
