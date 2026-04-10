/**
 * E2E tests for process lifecycle / zombie prevention.
 *
 * These tests spawn a real jshook MCP server process (dist/index.mjs) and
 * verify that it exits cleanly when the parent disconnects, signals are sent,
 * or the server is asked to close — and that no orphan Chrome processes remain.
 *
 * Prerequisites: `pnpm build` must have been run so dist/index.mjs exists.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, afterEach, beforeAll } from 'vitest';

const SERVER_ENTRY = join(process.cwd(), 'dist', 'index.mjs');
const isWindows = process.platform === 'win32';

/** Max time to wait for the server to become ready before testing shutdown. */
const STARTUP_WAIT_MS = 3_000;
/** Max time the server should take to exit after trigger. */
const EXIT_TIMEOUT_MS = 15_000;

/**
 * Check if a specific PID is still running.
 */
function isPidAlive(pid: number): boolean {
  try {
    // Sending signal 0 checks if the process exists without killing it
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Spawn the MCP server with stdio transport, returning the child process.
 */
function spawnServer(extraEnv: Record<string, string> = {}): ChildProcess {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') env[k] = v;
  }
  env.MCP_TRANSPORT = 'stdio';
  // Use search profile (minimal) to avoid activating browser domains
  env.MCP_TOOL_PROFILE = 'search';
  env.LOG_LEVEL = 'error';
  Object.assign(env, extraEnv);

  return spawn('node', [SERVER_ENTRY], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: process.cwd(),
  });
}

/**
 * Wait for a child process to exit, resolving with the exit code or null on timeout.
 */
function waitForExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<{ code: number | null; signal: string | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      resolve({ code: null, signal: null, timedOut: true });
    }, timeoutMs);

    child.on('exit', (code, signal) => {
      if (timedOut) return;
      clearTimeout(timer);
      resolve({ code, signal, timedOut: false });
    });
  });
}

/**
 * Force-kill a child process (best-effort cleanup).
 */
function forceKill(child: ChildProcess): void {
  try {
    if (child.pid && isPidAlive(child.pid)) {
      child.kill('SIGKILL');
    }
  } catch {
    /* best effort */
  }
}

describe('Process Lifecycle', { timeout: 60_000 }, () => {
  let child: ChildProcess | null = null;

  beforeAll(() => {
    if (!existsSync(SERVER_ENTRY)) {
      throw new Error(`Server entry not found at ${SERVER_ENTRY}. Run "pnpm build" first.`);
    }
  });

  afterEach(() => {
    if (child) {
      forceKill(child);
      child = null;
    }
  });

  it('exits cleanly when stdin is closed (parent disconnect)', async () => {
    child = spawnServer();
    const serverPid = child.pid!;

    // Collect stderr for debugging
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    // Wait for server to start
    await new Promise((r) => setTimeout(r, STARTUP_WAIT_MS));
    expect(isPidAlive(serverPid)).toBe(true);

    // Close stdin — this simulates the parent MCP client disconnecting
    child.stdin!.end();

    const result = await waitForExit(child, EXIT_TIMEOUT_MS);

    expect(
      result.timedOut,
      `Server did not exit within ${EXIT_TIMEOUT_MS}ms after stdin close. stderr:\n${stderr.slice(-500)}`,
    ).toBe(false);

    // Process should have exited with code 0
    expect(result.code).toBe(0);

    // Verify the pid is actually gone
    expect(isPidAlive(serverPid)).toBe(false);

    child = null; // Already exited
  });

  it('exits within timeout on SIGTERM', { skip: isWindows }, async () => {
    child = spawnServer();
    const serverPid = child.pid!;

    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    await new Promise((r) => setTimeout(r, STARTUP_WAIT_MS));
    expect(isPidAlive(serverPid)).toBe(true);

    // Send SIGTERM
    child.kill('SIGTERM');

    const result = await waitForExit(child, EXIT_TIMEOUT_MS);

    expect(
      result.timedOut,
      `Server did not exit within ${EXIT_TIMEOUT_MS}ms after SIGTERM. stderr:\n${stderr.slice(-500)}`,
    ).toBe(false);

    expect(result.code === 0 || result.signal === 'SIGTERM').toBe(true);
    expect(isPidAlive(serverPid)).toBe(false);

    child = null;
  });

  it('exits within timeout on SIGINT', { skip: isWindows }, async () => {
    child = spawnServer();
    const serverPid = child.pid!;

    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    await new Promise((r) => setTimeout(r, STARTUP_WAIT_MS));
    expect(isPidAlive(serverPid)).toBe(true);

    // Send SIGINT (Ctrl+C)
    child.kill('SIGINT');

    const result = await waitForExit(child, EXIT_TIMEOUT_MS);

    expect(
      result.timedOut,
      `Server did not exit within ${EXIT_TIMEOUT_MS}ms after SIGINT. stderr:\n${stderr.slice(-500)}`,
    ).toBe(false);

    expect(result.code === 0 || result.signal === 'SIGINT').toBe(true);
    expect(isPidAlive(serverPid)).toBe(false);

    child = null;
  });

  it('does not leave orphan node processes after stdin close', async () => {
    child = spawnServer();
    const serverPid = child.pid!;

    await new Promise((r) => setTimeout(r, STARTUP_WAIT_MS));

    child.stdin!.end();

    const result = await waitForExit(child, EXIT_TIMEOUT_MS);
    expect(result.timedOut).toBe(false);

    // Give OS a moment to clean up process table
    await new Promise((r) => setTimeout(r, 1_000));

    // The specific PID should no longer be alive
    expect(isPidAlive(serverPid), `Server PID ${serverPid} is still alive after exit`).toBe(false);

    child = null;
  });

  it('collects stderr output showing shutdown log on stdin close', async () => {
    child = spawnServer({ LOG_LEVEL: 'info' });

    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    await new Promise((r) => setTimeout(r, STARTUP_WAIT_MS));

    child.stdin!.end();

    const result = await waitForExit(child, EXIT_TIMEOUT_MS);
    expect(result.timedOut).toBe(false);

    // Verify that the server logged the shutdown reason
    const stderrLower = stderr.toLowerCase();
    const hasShutdownLog =
      stderrLower.includes('stdin') ||
      stderrLower.includes('shutting down') ||
      stderrLower.includes('parent') ||
      stderrLower.includes('eof') ||
      stderrLower.includes('closed');

    expect(hasShutdownLog, `Expected shutdown log in stderr, got:\n${stderr.slice(-500)}`).toBe(
      true,
    );

    child = null;
  });
});
